/**
 * Action Probability Model
 * Predicts the probability of each action type (pass, shot, drive)
 * 
 * Based on Fernández, Bornn, Cervone (2019):
 * "Decomposing the Immeasurable Sport: A deep learning EPV framework for soccer"
 * 
 * The paper uses CNNs on pitch control surfaces. This simplified version
 * uses heuristic rules based on:
 * - Pitch location
 * - Pressure level
 * - Distance to goal
 * - Teammate positions
 */

import { pitchControlAtPoint } from './pitchControl.js';
import { calculatePressure } from './ballDriveModel.js';

// Action types
export const ACTION_TYPES = {
    PASS: 'pass',
    DRIVE: 'drive',
    SHOT: 'shot'
};

/**
 * Calculate probability of taking a shot
 * Based on distance to goal, angle, and pressure
 * 
 * @param {Object} ballCarrier - Ball carrier position
 * @param {Object} gameState - Current game state
 * @returns {number} Shot probability (0-1)
 */
export function shotProbability(ballCarrier, gameState) {
    const { attackingRight, opponentPlayers } = gameState;

    // Goal position
    const goalX = attackingRight ? 52.5 : -52.5;
    const goalY = 0;

    // Distance to goal center
    const distToGoal = Math.sqrt(
        Math.pow(ballCarrier.x - goalX, 2) +
        Math.pow(ballCarrier.y - goalY, 2)
    );

    // Inside penalty box check (approximately)
    const attackingX = attackingRight ? ballCarrier.x : -ballCarrier.x;
    const inPenaltyBox = attackingX > 36 && Math.abs(ballCarrier.y) < 20.16;
    const inSixYardBox = attackingX > 47 && Math.abs(ballCarrier.y) < 9.16;

    // Base probability from distance
    let shotProb = 0;

    if (inSixYardBox) {
        shotProb = 0.7;  // Very likely to shoot
    } else if (inPenaltyBox) {
        // Decreases with distance within box
        shotProb = 0.5 * Math.exp(-(distToGoal - 11) / 10);
    } else if (distToGoal < 25) {
        // Outside box but close - possible shot
        shotProb = 0.15 * Math.exp(-(distToGoal - 16.5) / 8);
    } else {
        // Far from goal - very unlikely
        shotProb = 0.02 * Math.exp(-distToGoal / 40);
    }

    // Angle factor - central positions more likely to shoot
    const angleFactor = Math.exp(-Math.pow(ballCarrier.y, 2) / 400);
    shotProb *= angleFactor;

    // Pressure reduces shot probability (harder to shoot under pressure)
    const pressure = calculatePressure(ballCarrier, opponentPlayers);
    if (pressure.underHighPressure) {
        shotProb *= 0.6;
    } else if (pressure.pressureScore > 0.5) {
        shotProb *= 0.8;
    }

    return Math.min(0.9, Math.max(0.01, shotProb));
}

/**
 * Calculate probability of continuing to drive
 * Based on space ahead, pressure, and speed
 * 
 * @param {Object} ballCarrier - Ball carrier with velocity
 * @param {Object} gameState - Current game state
 * @returns {number} Drive probability (0-1)
 */
export function driveProbability(ballCarrier, gameState) {
    const { opponentPlayers, attackingRight } = gameState;

    // Current speed
    const speed = Math.sqrt(
        Math.pow(ballCarrier.vx || 0, 2) +
        Math.pow(ballCarrier.vy || 0, 2)
    );

    // Pressure level
    const pressure = calculatePressure(ballCarrier, opponentPlayers);

    // Base probability - higher if already moving
    let driveProb = 0.3;

    if (speed > 4) {
        driveProb = 0.5;  // Already driving, likely to continue
    } else if (speed > 2) {
        driveProb = 0.4;
    }

    // Space ahead factor
    // Check pitch control in the direction of movement
    const lookAheadDist = 5;  // meters
    const dirX = speed > 0.5 ? (ballCarrier.vx / speed) : (attackingRight ? 1 : -1);
    const dirY = speed > 0.5 ? (ballCarrier.vy / speed) : 0;

    const aheadX = ballCarrier.x + dirX * lookAheadDist;
    const aheadY = ballCarrier.y + dirY * lookAheadDist;

    // Check if there's space ahead
    const spaceAhead = pitchControlAtPoint(
        aheadX, aheadY,
        gameState.teamPlayers,
        opponentPlayers,
        gameState.ball || ballCarrier
    );

    // More space ahead = more likely to drive
    driveProb *= (0.5 + spaceAhead);

    // High pressure reduces drive probability
    if (pressure.underHighPressure) {
        driveProb *= 0.4;  // Need to release ball quickly
    } else if (pressure.pressureScore > 0.6) {
        driveProb *= 0.6;
    }

    // Position factor - less likely to drive in defensive third
    const attackingX = attackingRight ? ballCarrier.x : -ballCarrier.x;
    if (attackingX < -20) {
        driveProb *= 0.7;  // In own half, prefer passing
    }

    return Math.min(0.8, Math.max(0.1, driveProb));
}

/**
 * Calculate probability of making a pass
 * This is derived from shot and drive probabilities
 * 
 * @param {Object} ballCarrier - Ball carrier
 * @param {Object} gameState - Game state
 * @returns {number} Pass probability (0-1)
 */
export function passProbability(ballCarrier, gameState) {
    const pShot = shotProbability(ballCarrier, gameState);
    const pDrive = driveProbability(ballCarrier, gameState);

    // Pass is the complement of shot and drive
    // But ensure it never goes below a minimum
    const pPass = Math.max(0.2, 1 - pShot - pDrive);

    return pPass;
}

/**
 * Get all action probabilities
 * Implements action likelihood from the paper
 * 
 * @param {Object} ballCarrier - Ball carrier object
 * @param {Object} gameState - Current game state
 * @returns {Object} Probabilities for each action type
 */
export function getActionProbabilities(ballCarrier, gameState) {
    if (!ballCarrier) {
        return {
            [ACTION_TYPES.PASS]: 0.6,
            [ACTION_TYPES.DRIVE]: 0.35,
            [ACTION_TYPES.SHOT]: 0.05
        };
    }

    const pShot = shotProbability(ballCarrier, gameState);
    const pDrive = driveProbability(ballCarrier, gameState);

    // Normalize to ensure they sum to 1
    const total = pShot + pDrive + (1 - pShot - pDrive);

    let probs = {
        [ACTION_TYPES.SHOT]: pShot,
        [ACTION_TYPES.DRIVE]: pDrive,
        [ACTION_TYPES.PASS]: Math.max(0.15, 1 - pShot - pDrive)
    };

    // Normalize
    const sum = probs[ACTION_TYPES.SHOT] + probs[ACTION_TYPES.DRIVE] + probs[ACTION_TYPES.PASS];
    probs[ACTION_TYPES.SHOT] /= sum;
    probs[ACTION_TYPES.DRIVE] /= sum;
    probs[ACTION_TYPES.PASS] /= sum;

    return probs;
}

/**
 * Get the most likely action
 * 
 * @param {Object} ballCarrier - Ball carrier
 * @param {Object} gameState - Game state
 * @returns {Object} Most likely action with probability
 */
export function getMostLikelyAction(ballCarrier, gameState) {
    const probs = getActionProbabilities(ballCarrier, gameState);

    let maxProb = 0;
    let likelyAction = ACTION_TYPES.PASS;

    for (const [action, prob] of Object.entries(probs)) {
        if (prob > maxProb) {
            maxProb = prob;
            likelyAction = action;
        }
    }

    return {
        action: likelyAction,
        probability: maxProb,
        allProbabilities: probs
    };
}
