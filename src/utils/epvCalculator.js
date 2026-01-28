/**
 * Unified EPV Calculator
 * Integrates all EPV components following Fernández, Bornn, Cervone (2019)
 * 
 * This is the main entry point for full EPV analysis, combining:
 * - Pass value (with dynamic turnover EPV)
 * - Ball-drive value  
 * - Shot value (xG-based)
 * - Action probabilities
 * - Defensive line context
 */

import { calculateEPV, calculateDecomposedEPV, generateEPVSurface, calculateShotValue } from './epvModel.js';
import { evaluatePass, findPassOptions, calculateTurnoverEPV } from './passEvaluator.js';
import { evaluateBallDrive, calculatePressure, compareDriveWithPasses } from './ballDriveModel.js';
import { getActionProbabilities, getMostLikelyAction, ACTION_TYPES } from './actionModel.js';
import { detectDefensiveLines, getRelativeZone, analyzeLineBreaking } from './defensiveLines.js';
import { findBallCarrier, getTeammates, getOpponents } from './dataLoader.js';

/**
 * Full EPV analysis for a single frame
 * Returns comprehensive breakdown following paper's methodology
 * 
 * @param {Object} frame - Frame data with players, ball, etc.
 * @returns {Object} Complete EPV analysis
 */
export function analyzeFrame(frame) {
    // Determine teams and ball carrier
    const ballCarrier = findBallCarrier(frame);
    if (!ballCarrier) {
        return {
            epv: 0,
            hasCarrier: false,
            frame: frame.frameIndex
        };
    }

    const isHome = ballCarrier.team === 'home';
    const attackingRight = isHome ? frame.homeAttackingRight : !frame.homeAttackingRight;

    const teamPlayers = isHome ? frame.homePlayers : frame.awayPlayers;
    const opponentPlayers = isHome ? frame.awayPlayers : frame.homePlayers;
    const teammates = getTeammates(frame, ballCarrier);

    // Build game state
    const gameState = {
        teamPlayers,
        opponentPlayers,
        ball: frame.ball,
        attackingRight
    };

    // 1. Detect defensive lines (Z1-Z4 zones from paper)
    const defensiveLines = detectDefensiveLines(opponentPlayers, attackingRight);
    const ballZone = getRelativeZone(ballCarrier.x, ballCarrier.y, defensiveLines, attackingRight);

    // 2. Calculate pressure on ball carrier
    const pressure = calculatePressure(ballCarrier, opponentPlayers);

    // 3. Get action probabilities
    const actionProbs = getActionProbabilities(ballCarrier, gameState);
    const likelyAction = getMostLikelyAction(ballCarrier, gameState);

    // 4. Evaluate pass options
    const passOptions = findPassOptions(ballCarrier, teammates, gameState);
    const bestPass = passOptions[0] || null;
    const worstPass = passOptions[passOptions.length - 1] || null;

    // Analyze line-breaking for passes
    const passLineAnalysis = passOptions.map(pass => ({
        ...pass,
        lineBreaking: analyzeLineBreaking(ballCarrier, pass.target, defensiveLines, attackingRight)
    }));

    // 5. Evaluate ball-drive option
    const driveEval = evaluateBallDrive(ballCarrier, gameState);

    // 6. Calculate shot value
    const shotValue = calculateShotValue(ballCarrier.x, ballCarrier.y, gameState);

    // 7. Current simple EPV
    const currentEPV = calculateEPV(ballCarrier.x, ballCarrier.y, gameState);

    // 8. Full decomposed EPV (Paper's Equation 1)
    const decomposed = calculateDecomposedEPV(ballCarrier, gameState, {
        passBestEPV: bestPass?.expectedValue || 0,
        driveEPV: driveEval.driveEPV,
        actionProbabilities: {
            pass: actionProbs[ACTION_TYPES.PASS],
            drive: actionProbs[ACTION_TYPES.DRIVE],
            shot: actionProbs[ACTION_TYPES.SHOT]
        }
    });

    // 9. Compare actions to find best
    const actionComparison = compareDriveWithPasses(driveEval, passOptions);

    // 10. Calculate best/worst action EPV (for visualization like Figure 10)
    const allActionEPVs = [
        driveEval.driveEPV,
        shotValue,
        ...passOptions.map(p => p.expectedValue)
    ];
    const bestActionEPV = Math.max(...allActionEPVs, 0);
    const worstActionEPV = Math.min(...allActionEPVs, 0);

    return {
        // Core metrics
        epv: currentEPV,
        decomposedEPV: decomposed.decomposedEPV,

        // Ball carrier info
        ballCarrier: {
            id: ballCarrier.id,
            jerseyNum: ballCarrier.jerseyNum,
            position: ballCarrier.position,
            team: ballCarrier.team,
            x: ballCarrier.x,
            y: ballCarrier.y
        },

        // Context
        zone: ballZone,
        defensiveLines,
        pressure,

        // Action analysis
        actions: {
            probabilities: actionProbs,
            mostLikely: likelyAction,

            // Best/worst for decision-making visualization
            bestActionEPV,
            worstActionEPV,
            secondBestEPV: allActionEPVs.sort((a, b) => b - a)[1] || 0,

            // Recommendation
            recommendation: actionComparison.recommendedAction,
            shouldPass: actionComparison.shouldPass
        },

        // Pass breakdown
        passes: {
            count: passOptions.length,
            best: bestPass ? {
                target: bestPass.receiver?.jerseyNum,
                epv: bestPass.expectedValue,
                successProb: bestPass.successProbability,
                reward: bestPass.receiverEPV,
                risk: bestPass.turnoverEPV,
                lineBreaking: passLineAnalysis[0]?.lineBreaking
            } : null,
            worst: worstPass ? {
                target: worstPass.receiver?.jerseyNum,
                epv: worstPass.expectedValue
            } : null,
            allOptions: passOptions.slice(0, 5)  // Top 5
        },

        // Drive analysis
        drive: {
            epv: driveEval.driveEPV,
            projectedEPV: driveEval.projectedEPV,
            turnoverProb: driveEval.turnoverProbability,
            epvAdded: driveEval.epvAdded
        },

        // Shot analysis
        shot: {
            xG: shotValue,
            probability: actionProbs[ACTION_TYPES.SHOT]
        },

        // Full decomposition (paper's breakdown)
        decomposition: decomposed,

        // Frame metadata
        frame: frame.frameIndex,
        timestamp: frame.timestamp
    };
}

/**
 * Analyze EPV over multiple frames (for curve visualization)
 * Creates the "stock ticker" EPV curve from the paper
 * 
 * @param {Array} frames - Array of frame objects
 * @returns {Array} EPV analysis for each frame
 */
export function analyzeSequence(frames) {
    return frames.map(frame => {
        const analysis = analyzeFrame(frame);
        return {
            frameIndex: frame.frameIndex,
            timestamp: frame.timestamp,
            epv: analysis.epv,
            decomposedEPV: analysis.decomposedEPV,
            bestActionEPV: analysis.actions?.bestActionEPV || 0,
            worstActionEPV: analysis.actions?.worstActionEPV || 0,
            ballCarrier: analysis.ballCarrier,
            zone: analysis.zone?.zone
        };
    });
}

/**
 * Calculate EPV added by an action
 * 
 * @param {number} epvBefore - EPV before action
 * @param {number} epvAfter - EPV after action
 * @returns {Object} EPV added metrics
 */
export function calculateEPVAdded(epvBefore, epvAfter) {
    const added = epvAfter - epvBefore;

    let assessment;
    if (added > 0.05) assessment = 'excellent';
    else if (added > 0.02) assessment = 'good';
    else if (added > -0.02) assessment = 'neutral';
    else if (added > -0.05) assessment = 'poor';
    else assessment = 'bad';

    return {
        epvAdded: added,
        epvBefore,
        epvAfter,
        assessment,
        percentChange: epvBefore > 0 ? (added / epvBefore) * 100 : 0
    };
}

// Export all utilities for convenience
export {
    calculateEPV,
    calculateDecomposedEPV,
    generateEPVSurface,
    calculateShotValue
} from './epvModel.js';

export {
    evaluatePass,
    findPassOptions,
    calculateTurnoverEPV
} from './passEvaluator.js';

export {
    evaluateBallDrive,
    calculatePressure
} from './ballDriveModel.js';

export {
    getActionProbabilities,
    ACTION_TYPES
} from './actionModel.js';

export {
    detectDefensiveLines,
    getRelativeZone,
    analyzeLineBreaking
} from './defensiveLines.js';
