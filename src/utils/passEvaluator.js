/**
 * Pass Evaluator
 * Evaluates pass options and ranks them by Expected Possession Value Added (EPVA)
 * 
 * Based on Fernández, Bornn, Cervone (2019):
 * "Decomposing the Immeasurable Sport: A deep learning EPV framework for soccer"
 * 
 * Implements Equation 2:
 * E[X|A=ρ] = P(success) × E[successful pass] + P(turnover) × E[turnover]
 */

import { calculateEPV, generateEPVSurface, getEPVAt } from './epvModel.js';
import { calculateInterceptionProbability, generatePitchControlSurface, timeToIntercept } from './pitchControl.js';

// Constants
const BALL_SPEED = 15;           // m/s

/**
 * Calculate dynamic turnover EPV based on interception location
 * This implements the paper's approach where turnover value depends on
 * WHERE the ball is lost and WHO intercepts it.
 * 
 * @param {Object} passer - Passer position
 * @param {Object} receiver - Intended receiver position
 * @param {Array} opponents - Array of opponent players
 * @param {Object} gameState - Current game state
 * @returns {Object} Turnover info with EPV and likely interceptor
 */
export function calculateTurnoverEPV(passer, receiver, opponents, gameState) {
    const { attackingRight } = gameState;

    // Pass direction vector
    const passDistance = Math.sqrt(
        Math.pow(receiver.x - passer.x, 2) +
        Math.pow(receiver.y - passer.y, 2)
    );
    const dirX = (receiver.x - passer.x) / passDistance;
    const dirY = (receiver.y - passer.y) / passDistance;

    // Find most likely interception point along pass trajectory
    let bestInterceptor = null;
    let bestInterceptTime = Infinity;
    let interceptionPoint = { x: receiver.x, y: receiver.y };

    opponents.forEach(opponent => {
        // Project opponent onto pass line
        const toOppX = opponent.x - passer.x;
        const toOppY = opponent.y - passer.y;
        const projDist = toOppX * dirX + toOppY * dirY;

        if (projDist > 0 && projDist < passDistance) {
            // Point on pass line closest to opponent
            const interceptX = passer.x + projDist * dirX;
            const interceptY = passer.y + projDist * dirY;

            // Time for ball to reach this point
            const ballTime = projDist / BALL_SPEED;

            // Time for opponent to reach intercept point
            const oppTime = timeToIntercept(opponent, interceptX, interceptY);

            // If opponent can intercept (arrives before or near ball)
            if (oppTime < ballTime + 0.3 && oppTime < bestInterceptTime) {
                bestInterceptTime = oppTime;
                bestInterceptor = opponent;
                interceptionPoint = { x: interceptX, y: interceptY };
            }
        }
    });

    // If no interception found, assume turnover at receiver location
    if (!bestInterceptor) {
        // Find closest opponent to receiver
        let minDist = Infinity;
        opponents.forEach(opp => {
            const dist = Math.sqrt(
                Math.pow(opp.x - receiver.x, 2) +
                Math.pow(opp.y - receiver.y, 2)
            );
            if (dist < minDist) {
                minDist = dist;
                bestInterceptor = opp;
            }
        });
        interceptionPoint = { x: receiver.x, y: receiver.y };
    }

    // Calculate EPV from opponent's perspective after gaining possession
    // Flip the game state: defending team becomes attacking team
    const flippedGameState = {
        teamPlayers: gameState.opponentPlayers,
        opponentPlayers: gameState.teamPlayers,
        ball: interceptionPoint,
        attackingRight: !attackingRight
    };

    // EPV for opponent (negative from our perspective)
    const opponentEPV = calculateEPV(
        interceptionPoint.x,
        interceptionPoint.y,
        flippedGameState
    );

    // Return negative EPV (opponent's gain is our loss)
    return {
        turnoverEPV: -opponentEPV,
        interceptionPoint,
        interceptor: bestInterceptor
    };
}

/**
 * Evaluate a single pass option using paper's Equation 2
 * 
 * Key insight: The paper values PROGRESSION toward goal.
 * A backward pass (even with high control) should have lower value
 * than a forward pass into space.
 * 
 * @param {Object} passer - Passer player object
 * @param {Object} receiver - Receiver player object
 * @param {Object} gameState - Current game state
 * @param {Object} epvSurface - Pre-computed EPV surface (optional)
 * @returns {Object} Pass evaluation with EPV and success probability
 */
export function evaluatePass(passer, receiver, gameState, epvSurface = null) {
    const { opponentPlayers, teamPlayers, ball, attackingRight } = gameState;

    // Calculate interception probability
    const interceptProb = calculateInterceptionProbability(passer, receiver, opponentPlayers);
    const successProb = 1 - interceptProb;

    // Pass distance and time
    const passDistance = Math.sqrt(
        Math.pow(receiver.x - passer.x, 2) +
        Math.pow(receiver.y - passer.y, 2)
    );
    const passTime = passDistance / BALL_SPEED;

    // EPV at receiver position (successful pass value)
    const postPassGameState = {
        ...gameState,
        ball: { x: receiver.x, y: receiver.y, z: 0 }
    };

    let receiverEPV;
    if (epvSurface) {
        receiverEPV = getEPVAt(epvSurface, receiver.x, receiver.y);
    } else {
        receiverEPV = calculateEPV(receiver.x, receiver.y, postPassGameState);
    }

    // ========== CRITICAL FIX: Direction-based pass value adjustment ==========
    // The paper values PROGRESSION toward goal, not just control.
    // A backward pass should be penalized even if the receiver has high control.

    // Calculate pass direction relative to attacking direction
    const passDeltaX = receiver.x - passer.x;
    const passDirection = attackingRight ? passDeltaX : -passDeltaX;

    // Direction factor:
    // - Forward passes (toward goal): bonus multiplier (1.0 to 1.5)
    // - Lateral passes: neutral (1.0)
    // - Backward passes: penalty multiplier (0.3 to 0.8)
    let directionFactor;
    if (passDirection > 10) {
        // Strong forward pass - bonus
        directionFactor = 1.3 + Math.min(0.2, passDirection / 50);
    } else if (passDirection > 0) {
        // Slight forward - small bonus
        directionFactor = 1.0 + passDirection / 50;
    } else if (passDirection > -10) {
        // Slight backward - small penalty
        directionFactor = 1.0 + passDirection / 30;  // Will be < 1
    } else {
        // Strong backward pass (like to goalkeeper) - significant penalty
        // The further back, the bigger the penalty
        directionFactor = Math.max(0.3, 0.7 + passDirection / 50);
    }

    // Apply direction factor to receiver EPV
    // This ensures backward passes are valued lower
    const adjustedReceiverEPV = receiverEPV * directionFactor;

    // ========== End direction fix ==========

    // Calculate dynamic turnover EPV (Equation 2 from paper)
    const turnoverInfo = calculateTurnoverEPV(passer, receiver, opponentPlayers, gameState);
    const turnoverEPV = turnoverInfo.turnoverEPV;

    // Expected value using paper's decomposition:
    // E[pass] = P(success) × E[successful pass] + P(turnover) × E[turnover]
    const expectedValue = successProb * adjustedReceiverEPV + interceptProb * turnoverEPV;

    return {
        receiver,
        receiverEPV: adjustedReceiverEPV,  // Direction-adjusted reward
        rawReceiverEPV: receiverEPV,       // Original EPV for reference
        turnoverEPV,                        // Risk: value if pass fails
        directionFactor,                    // For debugging
        successProbability: successProb,
        interceptProbability: interceptProb,
        expectedValue,
        passDistance,
        passTime,
        passDirection: passDirection > 0 ? 'forward' : passDirection < -10 ? 'backward' : 'lateral',
        interceptionPoint: turnoverInfo.interceptionPoint,
        riskRewardDiff: adjustedReceiverEPV - Math.abs(turnoverEPV)
    };
}

/**
 * Find all viable pass options and rank by EPVA
 * 
 * @param {Object} ballCarrier - Ball carrier object
 * @param {Array} teammates - Array of teammate objects
 * @param {Object} gameState - Current game state
 * @returns {Array} Ranked pass options with EPVA
 */
export function findPassOptions(ballCarrier, teammates, gameState) {
    if (!ballCarrier || !teammates.length) return [];

    // Get current EPV
    const currentEPV = calculateEPV(ballCarrier.x, ballCarrier.y, gameState);

    // Generate EPV surface for efficient lookup
    const epvSurface = generateEPVSurface(gameState);

    // Evaluate each pass option
    const passOptions = teammates.map(teammate => {
        const evaluation = evaluatePass(ballCarrier, teammate, gameState, epvSurface);
        const epvAdded = evaluation.expectedValue - currentEPV;

        return {
            target: teammate,
            targetName: teammate.name || `#${teammate.jerseyNum}`,
            targetPosition: teammate.position,
            ...evaluation,
            currentEPV,
            epvAdded,
            // Risk assessment
            riskLevel: evaluation.interceptProbability > 0.5 ? 'high' :
                evaluation.interceptProbability > 0.25 ? 'medium' : 'low'
        };
    });

    // Sort by EPVA (highest first)
    passOptions.sort((a, b) => b.epvAdded - a.epvAdded);

    return passOptions;
}

/**
 * Get the optimal pass (highest EPVA with acceptable risk)
 * 
 * @param {Object} ballCarrier - Ball carrier
 * @param {Array} teammates - Teammates
 * @param {Object} gameState - Game state
 * @returns {Object|null} Best pass option or null
 */
export function getOptimalPass(ballCarrier, teammates, gameState) {
    const options = findPassOptions(ballCarrier, teammates, gameState);

    if (options.length === 0) return null;

    // Return the best option (already sorted by EPVA)
    return options[0];
}

/**
 * Categorize pass as forward, lateral, or backward
 * 
 * @param {Object} passer - Passer position
 * @param {Object} receiver - Receiver position
 * @param {boolean} attackingRight - Attacking direction
 * @returns {string} 'forward', 'lateral', or 'backward'
 */
export function getPassDirection(passer, receiver, attackingRight = true) {
    const dx = attackingRight ?
        (receiver.x - passer.x) :
        (passer.x - receiver.x);

    const dy = Math.abs(receiver.y - passer.y);

    if (dx > dy * 0.5) return 'forward';
    if (dx < -dy * 0.5) return 'backward';
    return 'lateral';
}

/**
 * Calculate pass angle relative to goal
 * 
 * @param {Object} passer - Passer position
 * @param {Object} receiver - Receiver position
 * @param {boolean} attackingRight - Attacking direction
 * @returns {number} Angle in degrees (-180 to 180)
 */
export function getPassAngle(passer, receiver, attackingRight = true) {
    const dx = receiver.x - passer.x;
    const dy = receiver.y - passer.y;

    let angle = Math.atan2(dy, dx) * (180 / Math.PI);

    // Normalize for attacking direction
    if (!attackingRight) {
        angle = angle + 180;
        if (angle > 180) angle -= 360;
    }

    return angle;
}

/**
 * Get color for pass arrow based on EPVA
 * 
 * @param {number} epvAdded - EPVA value
 * @returns {Object} Color object with stroke and fill
 */
export function getPassArrowColor(epvAdded) {
    // Normalize EPVA to color range
    // Positive = green, Negative = red, Zero = yellow

    if (epvAdded > 0.05) {
        // Strong positive - bright green
        return {
            stroke: '#22c55e',
            fill: 'rgba(34, 197, 94, 0.3)'
        };
    } else if (epvAdded > 0) {
        // Weak positive - light green
        return {
            stroke: '#86efac',
            fill: 'rgba(134, 239, 172, 0.3)'
        };
    } else if (epvAdded > -0.02) {
        // Neutral - yellow
        return {
            stroke: '#eab308',
            fill: 'rgba(234, 179, 8, 0.3)'
        };
    } else if (epvAdded > -0.05) {
        // Weak negative - orange
        return {
            stroke: '#f97316',
            fill: 'rgba(249, 115, 22, 0.3)'
        };
    } else {
        // Strong negative - red
        return {
            stroke: '#ef4444',
            fill: 'rgba(239, 68, 68, 0.3)'
        };
    }
}

/**
 * Calculate pass success probability display
 * 
 * @param {number} probability - Raw probability (0-1)
 * @returns {Object} Display data
 */
export function formatSuccessProbability(probability) {
    const percent = Math.round(probability * 100);

    let level, color;
    if (percent >= 80) {
        level = 'Very High';
        color = '#22c55e';
    } else if (percent >= 60) {
        level = 'High';
        color = '#86efac';
    } else if (percent >= 40) {
        level = 'Medium';
        color = '#eab308';
    } else if (percent >= 20) {
        level = 'Low';
        color = '#f97316';
    } else {
        level = 'Very Low';
        color = '#ef4444';
    }

    return { percent, level, color };
}
