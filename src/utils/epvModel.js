/**
 * Expected Possession Value (EPV) Model
 * 
 * IMPORTANT: EPV is NOT xG! 
 * - xG measures shot quality (only relevant near goal)
 * - EPV measures the VALUE OF POSSESSION at any location
 * 
 * Based on Fernández, Bornn, Cervone (2019):
 * EPV should show high values where:
 * 1. The attacking team has pitch control (space)
 * 2. There's potential to progress towards goal
 * 3. Good passing options exist
 * 
 * The paper shows red areas around TEAMMATES with space, not just at the goal!
 */

import { getPitchControlAt, generatePitchControlSurface, pitchControlAtPoint } from './pitchControl.js';

// Goal dimensions and position
const GOAL_WIDTH = 7.32;  // meters
const GOAL_HEIGHT = 2.44; // meters

/**
 * Calculate the PROGRESSION VALUE of a location
 * This is different from xG - it measures how valuable a location is 
 * for CONTINUING the possession, not for shooting.
 * 
 * A location has high progression value if:
 * - It's in advanced territory (closer to goal = higher potential)
 * - It's in a central corridor (more passing options)
 * - But decay is GRADUAL, not exponential like xG
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {boolean} attackingRight - True if attacking towards positive x
 * @returns {number} Progression value (0-1)
 */
export function progressionValue(x, y, attackingRight = true) {
    const pitchLength = 105;
    const pitchWidth = 68;

    // Normalize x to attacking direction (0 = own goal, 1 = opponent goal)
    const attackingX = attackingRight ? x : -x;
    const normalizedX = (attackingX + pitchLength / 2) / pitchLength;  // 0 to 1

    // Progressive value - steeper curve that properly penalizes defensive positions
    // Key insight: goalkeeper area should have VERY low progression value
    let progressionFactor;
    if (normalizedX < 0.15) {
        // Deep defensive (near own goal/goalkeeper): very low value
        // Even with high control, being this far back has minimal value
        progressionFactor = 0.05 + normalizedX * 0.3;  // Max 0.095
    } else if (normalizedX < 0.33) {
        // Defensive third: still low value
        progressionFactor = 0.1 + (normalizedX - 0.15) * 0.5;  // 0.1 to 0.19
    } else if (normalizedX < 0.50) {
        // Deep middle: moderate value
        progressionFactor = 0.2 + (normalizedX - 0.33) * 1.2;  // 0.2 to 0.4
    } else if (normalizedX < 0.66) {
        // Attacking middle: good value
        progressionFactor = 0.4 + (normalizedX - 0.50) * 1.5;  // 0.4 to 0.64
    } else if (normalizedX < 0.85) {
        // Attacking third: high value
        progressionFactor = 0.65 + (normalizedX - 0.66) * 1.2;  // 0.65 to 0.88
    } else {
        // Final zone near goal: highest value
        progressionFactor = 0.9 + (normalizedX - 0.85) * 0.6;  // 0.9 to 0.99
    }

    // Central corridor bonus (more passing lanes available)
    const normalizedY = Math.abs(y) / (pitchWidth / 2);  // 0 = center, 1 = sideline
    const centralBonus = 1 - 0.25 * normalizedY;  // Center is 25% more valuable

    // Combine: progression × central positioning
    return Math.min(1, progressionFactor * centralBonus);
}

/**
 * Calculate xG for shooting (only used for shot decisions)
 * This is kept separate from possession EPV
 */
export function shotXG(x, y, attackingRight = true) {
    const goalX = attackingRight ? 52.5 : -52.5;
    const distToGoal = Math.sqrt(Math.pow(x - goalX, 2) + Math.pow(y, 2));

    // Only meaningful close to goal
    if (distToGoal > 30) return 0.01;

    const distanceFactor = Math.exp(-distToGoal / 12);
    const angleFactor = Math.exp(-Math.pow(y, 2) / 150);

    return Math.min(0.8, distanceFactor * angleFactor);
}

/**
 * Get zone multiplier for strategic pitch zones
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {boolean} attackingRight - Attacking direction
 * @returns {number} Zone multiplier (0.5 - 1.5)
 */
export function getZoneMultiplier(x, y, attackingRight = true) {
    const attackingX = attackingRight ? x : -x;

    // Penalty box: x > 36, |y| < 20.16
    if (attackingX > 36 && Math.abs(y) < 20.16) {
        // Inside penalty area - high value
        return 1.5;
    }

    // Attacking third: x > 17.5
    if (attackingX > 17.5) {
        // Wing positions less valuable than central
        if (Math.abs(y) > 20) {
            return 1.1;
        }
        return 1.3;
    }

    // Middle third: -17.5 < x < 17.5
    if (attackingX > -17.5) {
        return 1.0;
    }

    // Defensive third
    return 0.6;
}

/**
 * Calculate shot expected value (xG-based)
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate  
 * @param {Object} gameState - Game state
 * @returns {number} Shot expected value
 */
export function calculateShotValue(x, y, gameState) {
    const { attackingRight } = gameState;

    // Use xG model for shot value (separate from EPV)
    return shotXG(x, y, attackingRight);
}

/**
 * Calculate EPV at a specific location (base calculation)
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} gameState - Current game state with players and ball
 * @param {Object} pitchControlSurface - Pre-computed pitch control (optional)
 * @returns {number} EPV value (0-1, probability of scoring)
 */
export function calculateEPV(x, y, gameState, pitchControlSurface = null) {
    const { teamPlayers, opponentPlayers, ball, attackingRight = true } = gameState;

    // 1. Progression value (how valuable is this location for possession)
    const progression = progressionValue(x, y, attackingRight);

    // 2. Pitch control at location (CRITICAL - this is what makes EPV different from static maps)
    // High control = team has space here, low control = opponents dominate
    let control;
    if (pitchControlSurface) {
        control = getPitchControlAt(pitchControlSurface, x, y);
    } else {
        control = pitchControlAtPoint(x, y, teamPlayers, opponentPlayers, ball);
    }

    // 3. Convert control to EPV contribution
    // Control > 0.5 = positive EPV (team dominates), < 0.5 = negative (opponent dominates)
    // This creates the red (positive) / blue (negative) divergent scale from the paper
    const controlContribution = (control - 0.5) * 2;  // Maps 0-1 to -1 to +1

    // 4. Combine: EPV = progression × control contribution
    // - High progression + team control = high positive EPV (red in paper)
    // - High progression + opponent control = negative EPV (blue in paper)
    // - Low progression areas have muted EPV regardless of control
    const epv = progression * controlContribution;

    // EPV is in [-1, 1] range per the paper
    return Math.max(-1, Math.min(1, epv));
}

/**
 * Calculate full decomposed EPV using paper's Equation 1
 * EPV = Σ P(A=a) × E[X | A=a]
 * 
 * This integrates pass, drive, and shot values weighted by action probabilities.
 * 
 * @param {Object} ballCarrier - Ball carrier object
 * @param {Object} gameState - Current game state
 * @param {Object} options - Calculation options
 * @returns {Object} Full EPV breakdown with all components
 */
export function calculateDecomposedEPV(ballCarrier, gameState, options = {}) {
    // Import action model and ball drive dynamically to avoid circular deps
    // In actual usage, import at top of file
    const {
        passBestEPV = 0,
        driveEPV = 0,
        actionProbabilities = { pass: 0.5, drive: 0.4, shot: 0.1 }
    } = options;

    const { attackingRight } = gameState;

    // Current position EPV (simple calculation)
    const currentEPV = ballCarrier
        ? calculateEPV(ballCarrier.x, ballCarrier.y, gameState)
        : 0;

    // Shot value
    const shotValue = ballCarrier
        ? calculateShotValue(ballCarrier.x, ballCarrier.y, gameState)
        : 0;

    // Use provided values or defaults
    const P_pass = actionProbabilities.pass || 0.5;
    const P_drive = actionProbabilities.drive || 0.4;
    const P_shot = actionProbabilities.shot || 0.1;

    // Paper's Equation 1:
    // EPV = P(pass) × E[pass] + P(drive) × E[drive] + P(shot) × E[shot]
    const decomposedEPV = (
        P_pass * passBestEPV +
        P_drive * driveEPV +
        P_shot * shotValue
    );

    return {
        currentEPV,
        decomposedEPV,
        components: {
            passEPV: passBestEPV,
            driveEPV: driveEPV,
            shotEPV: shotValue
        },
        actionProbabilities: {
            pass: P_pass,
            drive: P_drive,
            shot: P_shot
        },
        breakdown: {
            passContribution: P_pass * passBestEPV,
            driveContribution: P_drive * driveEPV,
            shotContribution: P_shot * shotValue
        }
    };
}

/**
 * Generate EPV surface for entire pitch
 * 
 * @param {Object} gameState - Current game state
 * @param {Object} options - Grid options
 * @returns {Object} EPV grid data
 */
export function generateEPVSurface(gameState, options = {}) {
    const {
        pitchLength = 105,
        pitchWidth = 68,
        resolution = 2
    } = options;

    const { teamPlayers, opponentPlayers, ball, attackingRight = true } = gameState;

    // First generate pitch control surface
    const pitchControlSurface = generatePitchControlSurface(
        teamPlayers,
        opponentPlayers,
        ball,
        { pitchLength, pitchWidth, resolution }
    );

    const gridWidth = Math.ceil(pitchLength / resolution);
    const gridHeight = Math.ceil(pitchWidth / resolution);

    const grid = [];
    let maxEPV = -1;
    let minEPV = 1;

    for (let yi = 0; yi < gridHeight; yi++) {
        const row = [];
        for (let xi = 0; xi < gridWidth; xi++) {
            const x = (xi * resolution) - (pitchLength / 2) + (resolution / 2);
            const y = (yi * resolution) - (pitchWidth / 2) + (resolution / 2);

            // Use pitch control to calculate EPV
            const control = pitchControlSurface.grid[yi][xi];
            const progression = progressionValue(x, y, attackingRight);

            // Convert control to divergent scale
            const controlContribution = (control - 0.5) * 2;
            const epv = progression * controlContribution;

            row.push(epv);

            maxEPV = Math.max(maxEPV, epv);
            minEPV = Math.min(minEPV, epv);
        }
        grid.push(row);
    }

    return {
        grid,
        gridWidth,
        gridHeight,
        resolution,
        pitchLength,
        pitchWidth,
        maxEPV,
        minEPV,
        pitchControlSurface
    };
}

/**
 * Get EPV at a specific point from pre-computed surface
 * 
 * @param {Object} surface - EPV surface
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {number} EPV value
 */
export function getEPVAt(surface, x, y) {
    const { grid, resolution, pitchLength, pitchWidth } = surface;

    const xi = Math.floor((x + pitchLength / 2) / resolution);
    const yi = Math.floor((y + pitchWidth / 2) / resolution);

    if (yi < 0 || yi >= grid.length || xi < 0 || xi >= grid[0].length) {
        return 0;
    }

    return grid[yi][xi];
}

/**
 * Calculate EPV for ball carrier's current position
 * 
 * @param {Object} ballCarrier - Ball carrier object
 * @param {Object} gameState - Game state
 * @returns {number} Current EPV
 */
export function getCurrentEPV(ballCarrier, gameState) {
    if (!ballCarrier) return 0;

    return calculateEPV(
        ballCarrier.x,
        ballCarrier.y,
        gameState
    );
}

/**
 * Color interpolation for EPV visualization
 * Blue (negative/opponent control) -> White (neutral) -> Red (positive/team control)
 * This matches the paper's divergent color scale
 * 
 * @param {number} value - EPV value (-1 to 1)
 * @returns {string} RGB color string
 */
export function getEPVColor(value) {
    // EPV is now -1 to 1, normalize to 0-1 for color mapping
    // -1 = full blue (opponent control)
    // 0 = white (neutral)
    // +1 = full red (team control)
    const t = (value + 1) / 2;  // Maps -1..1 to 0..1
    const clamped = Math.max(0, Math.min(1, t));

    let r, g, b;

    if (clamped < 0.5) {
        // Blue to White (opponent control to neutral)
        const s = clamped * 2; // 0 to 1
        r = Math.round(50 + s * 205);    // 50 -> 255
        g = Math.round(100 + s * 155);   // 100 -> 255
        b = Math.round(200 + s * 55);    // 200 -> 255
    } else {
        // White to Red (neutral to team control)
        const s = (clamped - 0.5) * 2; // 0 to 1
        r = 255;                          // 255 -> 255
        g = Math.round(255 - s * 180);    // 255 -> 75
        b = Math.round(255 - s * 200);    // 255 -> 55
    }

    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Get alpha value for EPV overlay
 * Higher magnitude EPV = more visible
 * 
 * @param {number} value - EPV value (-1 to 1)
 * @returns {number} Alpha (0.2-0.7)
 */
export function getEPVAlpha(value) {
    // Use absolute value - strong positive OR negative should be visible
    const magnitude = Math.abs(value);
    // Base 0.2 (slightly visible everywhere) -> Max 0.7 for strong control
    return 0.2 + magnitude * 0.5;
}
