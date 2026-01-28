/**
 * Ball-Drive Value Model
 * Evaluates the expected value of carrying (driving) the ball
 * 
 * Based on Fernández, Bornn, Cervone (2019):
 * "Decomposing the Immeasurable Sport: A deep learning EPV framework for soccer"
 * 
 * Ball drives are evaluated every ~0.25 seconds during possession.
 * Value depends on:
 * - Current EPV position
 * - EPV at projected position (based on velocity)
 * - Probability of losing possession during drive
 */

import { calculateEPV, generateEPVSurface, getEPVAt } from './epvModel.js';
import { pitchControlAtPoint, timeToIntercept } from './pitchControl.js';

// Constants
const DRIVE_EVALUATION_INTERVAL = 0.25;  // seconds (from paper)
const TYPICAL_DRIBBLE_SPEED = 4.5;       // m/s
const PRESSURE_RADIUS = 3;               // meters - close defender radius
const HIGH_PRESSURE_RADIUS = 1.5;        // meters - very close defender

/**
 * Calculate pressure level on ball carrier
 * 
 * @param {Object} ballCarrier - Ball carrier with x, y coordinates
 * @param {Array} opponents - Array of opponent players
 * @returns {Object} Pressure metrics
 */
export function calculatePressure(ballCarrier, opponents) {
    let closestDist = Infinity;
    let closestOpponent = null;
    let opponentsInRadius = 0;
    let opponentsInHighPressure = 0;

    opponents.forEach(opp => {
        const dist = Math.sqrt(
            Math.pow(opp.x - ballCarrier.x, 2) +
            Math.pow(opp.y - ballCarrier.y, 2)
        );

        if (dist < closestDist) {
            closestDist = dist;
            closestOpponent = opp;
        }

        if (dist < PRESSURE_RADIUS) {
            opponentsInRadius++;
        }
        if (dist < HIGH_PRESSURE_RADIUS) {
            opponentsInHighPressure++;
        }
    });

    // Pressure score: 0 (no pressure) to 1 (high pressure)
    let pressureScore = 0;
    if (closestDist < HIGH_PRESSURE_RADIUS) {
        pressureScore = 0.9 + (opponentsInHighPressure - 1) * 0.05;
    } else if (closestDist < PRESSURE_RADIUS) {
        pressureScore = 0.4 + (0.5 * (PRESSURE_RADIUS - closestDist) / (PRESSURE_RADIUS - HIGH_PRESSURE_RADIUS));
    } else if (closestDist < 6) {
        pressureScore = 0.2 * (6 - closestDist) / 3;
    }

    return {
        pressureScore: Math.min(1, pressureScore),
        closestOpponentDistance: closestDist,
        closestOpponent,
        opponentsNearby: opponentsInRadius,
        underHighPressure: opponentsInHighPressure > 0
    };
}

/**
 * Calculate probability of losing possession during a ball drive
 * Based on pressure, speed, and direction
 * 
 * @param {Object} ballCarrier - Ball carrier object with velocity
 * @param {Array} opponents - Opponents
 * @param {number} driveTime - Duration of drive in seconds
 * @returns {number} Probability of losing possession (0-1)
 */
export function driveTurnoverProbability(ballCarrier, opponents, driveTime = DRIVE_EVALUATION_INTERVAL) {
    const pressure = calculatePressure(ballCarrier, opponents);

    // Base turnover probability based on pressure
    let baseProb = pressure.pressureScore * 0.3;  // Max 30% per 0.25s under max pressure

    // Speed factor - higher speed = slightly higher risk but less time under pressure
    const speed = Math.sqrt(
        Math.pow(ballCarrier.vx || 0, 2) +
        Math.pow(ballCarrier.vy || 0, 2)
    );

    // Fast movement reduces time under pressure but increases control difficulty
    if (speed > 6) {
        baseProb *= 1.1;  // Slight increase for very fast movement
    } else if (speed < 2) {
        baseProb *= 1.2;  // Static players are easier to press
    }

    // Direction factor - moving towards closest opponent is risky
    if (pressure.closestOpponent && speed > 0.5) {
        const toOpponent = {
            x: pressure.closestOpponent.x - ballCarrier.x,
            y: pressure.closestOpponent.y - ballCarrier.y
        };
        const toOppDist = Math.sqrt(toOpponent.x * toOpponent.x + toOpponent.y * toOpponent.y);

        // Dot product to check if moving towards opponent
        const movingTowards = (
            (ballCarrier.vx || 0) * (toOpponent.x / toOppDist) +
            (ballCarrier.vy || 0) * (toOpponent.y / toOppDist)
        ) / speed;

        if (movingTowards > 0.5) {
            baseProb *= 1.3;  // Moving towards defender
        } else if (movingTowards < -0.5) {
            baseProb *= 0.8;  // Moving away from defender
        }
    }

    // Scale by time
    const prob = 1 - Math.pow(1 - baseProb, driveTime / DRIVE_EVALUATION_INTERVAL);

    return Math.min(0.95, Math.max(0, prob));
}

/**
 * Project ball carrier position after drive
 * 
 * @param {Object} ballCarrier - Ball carrier with position and velocity
 * @param {number} driveTime - Duration of drive
 * @param {Object} options - Pitch boundaries
 * @returns {Object} Projected position
 */
export function projectDrivePosition(ballCarrier, driveTime = DRIVE_EVALUATION_INTERVAL, options = {}) {
    const { pitchLength = 105, pitchWidth = 68 } = options;

    const vx = ballCarrier.vx || 0;
    const vy = ballCarrier.vy || 0;

    // Project position
    let newX = ballCarrier.x + vx * driveTime;
    let newY = ballCarrier.y + vy * driveTime;

    // Clamp to pitch boundaries
    const halfLength = pitchLength / 2;
    const halfWidth = pitchWidth / 2;

    newX = Math.max(-halfLength, Math.min(halfLength, newX));
    newY = Math.max(-halfWidth, Math.min(halfWidth, newY));

    return { x: newX, y: newY };
}

/**
 * Evaluate ball-drive action
 * Returns the expected value of continuing to carry the ball
 * 
 * @param {Object} ballCarrier - Ball carrier object
 * @param {Object} gameState - Current game state
 * @param {Object} epvSurface - Pre-computed EPV surface (optional)
 * @returns {Object} Drive evaluation with EPV
 */
export function evaluateBallDrive(ballCarrier, gameState, epvSurface = null) {
    const { teamPlayers, opponentPlayers, ball, attackingRight } = gameState;

    if (!ballCarrier) {
        return {
            driveEPV: 0,
            epvAdded: 0,
            turnoverProbability: 1,
            projectedPosition: ball || { x: 0, y: 0 }
        };
    }

    // Current EPV
    let currentEPV;
    if (epvSurface) {
        currentEPV = getEPVAt(epvSurface, ballCarrier.x, ballCarrier.y);
    } else {
        currentEPV = calculateEPV(ballCarrier.x, ballCarrier.y, gameState);
    }

    // Project position after drive
    const projectedPos = projectDrivePosition(ballCarrier);

    // EPV at projected position
    let projectedEPV;
    if (epvSurface) {
        projectedEPV = getEPVAt(epvSurface, projectedPos.x, projectedPos.y);
    } else {
        const projectedGameState = {
            ...gameState,
            ball: projectedPos
        };
        projectedEPV = calculateEPV(projectedPos.x, projectedPos.y, projectedGameState);
    }

    // Turnover probability during drive
    const turnoverProb = driveTurnoverProbability(ballCarrier, opponentPlayers);
    const successProb = 1 - turnoverProb;

    // Turnover EPV (opponent gains possession at current location)
    const flippedState = {
        teamPlayers: opponentPlayers,
        opponentPlayers: teamPlayers,
        ball: ballCarrier,
        attackingRight: !attackingRight
    };
    const turnoverEPV = -calculateEPV(ballCarrier.x, ballCarrier.y, flippedState);

    // Expected drive value using paper's decomposition
    const driveEPV = successProb * projectedEPV + turnoverProb * turnoverEPV;

    return {
        driveEPV,
        currentEPV,
        projectedEPV,
        epvAdded: driveEPV - currentEPV,
        turnoverProbability: turnoverProb,
        turnoverEPV,
        projectedPosition: projectedPos,
        pressure: calculatePressure(ballCarrier, opponentPlayers)
    };
}

/**
 * Compare drive option with pass options
 * Helps decision-making analysis
 * 
 * @param {Object} driveEval - Ball drive evaluation
 * @param {Array} passOptions - Array of pass evaluations
 * @returns {Object} Comparison with best action recommendation
 */
export function compareDriveWithPasses(driveEval, passOptions) {
    const sortedPasses = [...passOptions].sort((a, b) => b.expectedValue - a.expectedValue);
    const bestPass = sortedPasses[0];

    const actions = [
        { type: 'drive', epv: driveEval.driveEPV, details: driveEval }
    ];

    if (bestPass) {
        actions.push({
            type: 'pass',
            epv: bestPass.expectedValue,
            target: bestPass.receiver,
            details: bestPass
        });
    }

    actions.sort((a, b) => b.epv - a.epv);

    return {
        recommendedAction: actions[0].type,
        bestDriveEPV: driveEval.driveEPV,
        bestPassEPV: bestPass?.expectedValue || 0,
        epvDifference: driveEval.driveEPV - (bestPass?.expectedValue || 0),
        shouldPass: bestPass && bestPass.expectedValue > driveEval.driveEPV,
        allActions: actions
    };
}
