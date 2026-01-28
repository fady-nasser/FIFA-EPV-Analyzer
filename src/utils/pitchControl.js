/**
 * Pitch Control Model
 * Implements time-to-intercept based pitch control calculation
 * Based on Fernández et al. methodology
 */

// Physical constants
const PLAYER_MAX_SPEED = 5.5;        // m/s (top speed)
const PLAYER_ACCELERATION = 3.5;    // m/s²
const REACTION_TIME = 0.7;          // seconds
const BALL_SPEED = 15;              // m/s (average pass speed)

// Position-based speed modifiers
const POSITION_SPEED_FACTORS = {
    'GK': 0.85,
    'CB': 0.90,
    'LCB': 0.90,
    'RCB': 0.90,
    'LB': 0.95,
    'RB': 0.95,
    'CM': 0.92,
    'CDM': 0.90,
    'CAM': 0.93,
    'AM': 0.93,
    'LM': 0.98,
    'RM': 0.98,
    'LW': 1.0,
    'RW': 1.0,
    'CF': 0.95,
    'ST': 0.95
};

/**
 * Calculate time for a player to reach a target point
 * Uses physics-based motion model with reaction time
 * 
 * @param {Object} player - Player object with x, y, vx, vy
 * @param {number} targetX - Target x coordinate
 * @param {number} targetY - Target y coordinate
 * @returns {number} Time in seconds to reach target
 */
export function timeToIntercept(player, targetX, targetY) {
    // Distance to target
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 0.5) return 0; // Already there

    // Get player's max speed based on position
    const speedFactor = POSITION_SPEED_FACTORS[player.position] || 0.95;
    const maxSpeed = PLAYER_MAX_SPEED * speedFactor;

    // Current velocity component towards target
    const vx = player.vx || 0;
    const vy = player.vy || 0;
    const currentSpeed = Math.sqrt(vx * vx + vy * vy);

    // Direction to target
    const dirX = dx / distance;
    const dirY = dy / distance;

    // Component of current velocity towards target
    const velocityTowardsTarget = vx * dirX + vy * dirY;

    // Time calculation using kinematics
    // t = reaction_time + acceleration_phase + constant_speed_phase

    // Time to accelerate from current speed to max speed
    const speedDiff = maxSpeed - Math.max(0, velocityTowardsTarget);
    const accelTime = speedDiff / PLAYER_ACCELERATION;

    // Distance covered during acceleration (using kinematics)
    const accelDistance = velocityTowardsTarget * accelTime +
        0.5 * PLAYER_ACCELERATION * accelTime * accelTime;

    // Remaining distance at max speed
    const remainingDistance = Math.max(0, distance - accelDistance);
    const constantSpeedTime = remainingDistance / maxSpeed;

    return REACTION_TIME + accelTime + constantSpeedTime;
}

/**
 * Calculate ball travel time to a point
 * @param {Object} ball - Ball position {x, y}
 * @param {number} targetX - Target x
 * @param {number} targetY - Target y
 * @returns {number} Time in seconds
 */
export function ballTravelTime(ball, targetX, targetY) {
    const distance = Math.sqrt(
        Math.pow(targetX - ball.x, 2) +
        Math.pow(targetY - ball.y, 2)
    );
    return distance / BALL_SPEED;
}

/**
 * Calculate pitch control probability at a single point
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Array} teamPlayers - Array of team players
 * @param {Array} opponentPlayers - Array of opponent players
 * @param {Object} ball - Ball position
 * @returns {number} Probability (0-1) that team controls this point
 */
export function pitchControlAtPoint(x, y, teamPlayers, opponentPlayers, ball) {
    const ballTime = ballTravelTime(ball, x, y);

    // Calculate influence from team players
    let teamInfluence = 0;
    teamPlayers.forEach(player => {
        const tti = timeToIntercept(player, x, y);
        // Player can intercept if they arrive before or shortly after ball
        const timeAdvantage = ballTime - tti;
        // Sigmoid function to convert time advantage to probability
        const influence = 1 / (1 + Math.exp(-4 * timeAdvantage));
        teamInfluence += influence;
    });

    // Calculate influence from opponents
    let opponentInfluence = 0;
    opponentPlayers.forEach(player => {
        const tti = timeToIntercept(player, x, y);
        const timeAdvantage = ballTime - tti;
        const influence = 1 / (1 + Math.exp(-4 * timeAdvantage));
        opponentInfluence += influence;
    });

    // Normalize to probability
    const totalInfluence = teamInfluence + opponentInfluence;
    if (totalInfluence === 0) return 0.5;

    return teamInfluence / totalInfluence;
}

/**
 * Generate pitch control surface for entire pitch
 * 
 * @param {Array} teamPlayers - Attacking team players
 * @param {Array} opponentPlayers - Defending team players
 * @param {Object} ball - Ball position
 * @param {Object} options - Grid options
 * @returns {Object} Grid data with pitch control values
 */
export function generatePitchControlSurface(
    teamPlayers,
    opponentPlayers,
    ball,
    options = {}
) {
    const {
        pitchLength = 105,
        pitchWidth = 68,
        resolution = 2  // meters per grid cell
    } = options;

    const gridWidth = Math.ceil(pitchLength / resolution);
    const gridHeight = Math.ceil(pitchWidth / resolution);

    const grid = [];

    for (let yi = 0; yi < gridHeight; yi++) {
        const row = [];
        for (let xi = 0; xi < gridWidth; xi++) {
            // Convert grid coordinates to pitch coordinates
            // Pitch is centered at (0, 0), so x goes from -52.5 to 52.5
            const x = (xi * resolution) - (pitchLength / 2) + (resolution / 2);
            const y = (yi * resolution) - (pitchWidth / 2) + (resolution / 2);

            const control = pitchControlAtPoint(x, y, teamPlayers, opponentPlayers, ball);
            row.push(control);
        }
        grid.push(row);
    }

    return {
        grid,
        gridWidth,
        gridHeight,
        resolution,
        pitchLength,
        pitchWidth
    };
}

/**
 * Get pitch control value at a specific point from pre-computed grid
 * 
 * @param {Object} surface - Pre-computed pitch control surface
 * @param {number} x - X coordinate on pitch
 * @param {number} y - Y coordinate on pitch
 * @returns {number} Pitch control value (0-1)
 */
export function getPitchControlAt(surface, x, y) {
    const { grid, resolution, pitchLength, pitchWidth } = surface;

    // Convert pitch coords to grid indices
    const xi = Math.floor((x + pitchLength / 2) / resolution);
    const yi = Math.floor((y + pitchWidth / 2) / resolution);

    // Bounds check
    if (yi < 0 || yi >= grid.length || xi < 0 || xi >= grid[0].length) {
        return 0.5;
    }

    return grid[yi][xi];
}

/**
 * Calculate pass interception probability
 * 
 * @param {Object} passer - Passer player object
 * @param {Object} receiver - Receiver player object
 * @param {Array} opponents - Array of opponent players
 * @returns {number} Probability of interception (0-1)
 */
export function calculateInterceptionProbability(passer, receiver, opponents) {
    const passDistance = Math.sqrt(
        Math.pow(receiver.x - passer.x, 2) +
        Math.pow(receiver.y - passer.y, 2)
    );

    const passTravelTime = passDistance / BALL_SPEED;

    // Pass direction
    const dirX = (receiver.x - passer.x) / passDistance;
    const dirY = (receiver.y - passer.y) / passDistance;

    let maxInterceptionProb = 0;

    opponents.forEach(opponent => {
        // Project opponent position onto pass line
        const toOpponentX = opponent.x - passer.x;
        const toOpponentY = opponent.y - passer.y;

        // Distance along pass line
        const projDist = toOpponentX * dirX + toOpponentY * dirY;

        // Only consider opponents in pass path
        if (projDist > 0 && projDist < passDistance) {
            // Perpendicular distance from pass line
            const perpDist = Math.abs(toOpponentX * (-dirY) + toOpponentY * dirX);

            // Time for ball to reach this point
            const ballTimeToPoint = projDist / BALL_SPEED;

            // Time for opponent to reach pass line
            const timeToLine = timeToIntercept(opponent,
                passer.x + projDist * dirX,
                passer.y + projDist * dirY
            );

            // Interception probability based on timing
            const timeDiff = ballTimeToPoint - timeToLine;
            const prob = 1 / (1 + Math.exp(-5 * timeDiff));

            // Reduce probability based on perpendicular distance
            const distanceFactor = Math.exp(-perpDist / 3);
            const interceptProb = prob * distanceFactor;

            maxInterceptionProb = Math.max(maxInterceptionProb, interceptProb);
        }
    });

    // Also factor in pass distance (longer passes = higher risk)
    const distanceRisk = 1 - Math.exp(-passDistance / 40);

    return Math.min(0.95, maxInterceptionProb + distanceRisk * 0.1);
}
