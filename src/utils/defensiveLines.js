/**
 * Defensive Lines Detection
 * Identifies dynamic defensive formation lines (Z1-Z4 zones)
 * 
 * Based on Fernández, Bornn, Cervone (2019):
 * "Decomposing the Immeasurable Sport: A deep learning EPV framework for soccer"
 * 
 * The paper uses spectral clustering on player X-coordinates in 2-second windows.
 * This implementation uses a simplified k-means approach with 3 clusters:
 * - First pressure line (typically forwards)
 * - Second pressure line (typically midfielders)
 * - Third pressure line (typically defenders)
 */

/**
 * Simple k-means clustering for 1D data (X coordinates)
 * Groups defending players into 3 formation lines
 * 
 * @param {Array} positions - Array of X coordinates
 * @param {number} k - Number of clusters (default 3)
 * @param {number} maxIterations - Max iterations (default 50)
 * @returns {Array} Array of cluster centroids sorted by position
 */
function kMeans1D(positions, k = 3, maxIterations = 50) {
    if (positions.length < k) {
        return positions.sort((a, b) => a - b);
    }

    // Initialize centroids evenly across range
    const min = Math.min(...positions);
    const max = Math.max(...positions);
    const range = max - min;

    let centroids = [];
    for (let i = 0; i < k; i++) {
        centroids.push(min + (range * (i + 0.5)) / k);
    }

    // Iterate
    for (let iter = 0; iter < maxIterations; iter++) {
        // Assign points to nearest centroid
        const clusters = new Array(k).fill(null).map(() => []);

        positions.forEach(pos => {
            let minDist = Infinity;
            let nearestCluster = 0;

            centroids.forEach((c, i) => {
                const dist = Math.abs(pos - c);
                if (dist < minDist) {
                    minDist = dist;
                    nearestCluster = i;
                }
            });

            clusters[nearestCluster].push(pos);
        });

        // Update centroids
        const newCentroids = clusters.map((cluster, i) => {
            if (cluster.length === 0) return centroids[i];
            return cluster.reduce((a, b) => a + b, 0) / cluster.length;
        });

        // Check convergence
        const maxChange = Math.max(
            ...centroids.map((c, i) => Math.abs(c - newCentroids[i]))
        );

        centroids = newCentroids;

        if (maxChange < 0.5) break;  // Converged
    }

    return centroids.sort((a, b) => a - b);
}

/**
 * Detect defensive pressure lines
 * Groups defending players into 3 formation lines
 * 
 * @param {Array} defenders - Array of defending player objects
 * @param {boolean} attackingRight - Direction of attack (true = right, false = left)
 * @returns {Object} Defensive line positions and assignments
 */
export function detectDefensiveLines(defenders, attackingRight = true) {
    if (!defenders || defenders.length === 0) {
        return {
            lines: [0, 0, 0],
            firstLine: 0,
            secondLine: 0,
            thirdLine: 0,
            assignments: {}
        };
    }

    // Extract X coordinates (flip if attacking left)
    const xPositions = defenders.map(d => attackingRight ? d.x : -d.x);

    // Cluster into 3 lines
    const lines = kMeans1D(xPositions, 3);

    // Flip back if needed
    const actualLines = attackingRight
        ? lines
        : lines.map(x => -x).reverse();

    // Assign players to lines
    const assignments = {};
    defenders.forEach(player => {
        const playerX = attackingRight ? player.x : -player.x;

        // Find nearest line
        let nearestLine = 0;
        let minDist = Infinity;

        lines.forEach((line, i) => {
            const dist = Math.abs(playerX - line);
            if (dist < minDist) {
                minDist = dist;
                nearestLine = i + 1;  // 1-indexed
            }
        });

        assignments[player.id || player.jerseyNum] = nearestLine;
    });

    return {
        lines: actualLines,
        firstLine: actualLines[0],   // Closest to ball / forwards
        secondLine: actualLines[1],  // Middle line / midfielders
        thirdLine: actualLines[2],   // Deepest / defenders
        assignments
    };
}

/**
 * Get relative zone for a position
 * Z1: Behind first line (build-up)
 * Z2: Between first and second line (progression)
 * Z3: Between second and third line (pre-finalization)
 * Z4: Beyond third line (finalization)
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} defensiveLines - Defensive line detection result
 * @param {boolean} attackingRight - Attacking direction
 * @returns {Object} Zone information
 */
export function getRelativeZone(x, y, defensiveLines, attackingRight = true) {
    const { firstLine, secondLine, thirdLine } = defensiveLines;
    const playerX = attackingRight ? x : -x;
    const line1 = attackingRight ? firstLine : -firstLine;
    const line2 = attackingRight ? secondLine : -secondLine;
    const line3 = attackingRight ? thirdLine : -thirdLine;

    let zone, zoneName, phase;

    if (playerX < line1) {
        zone = 'Z1';
        zoneName = 'Behind First Line';
        phase = 'build-up';
    } else if (playerX < line2) {
        zone = 'Z2';
        zoneName = 'Between First and Second Line';
        phase = 'progression';
    } else if (playerX < line3) {
        zone = 'Z3';
        zoneName = 'Between Second and Third Line';
        phase = 'pre-finalization';
    } else {
        zone = 'Z4';
        zoneName = 'Beyond Third Line';
        phase = 'finalization';
    }

    return {
        zone,
        zoneName,
        phase,
        x,
        y,
        nearestLineDistance: Math.min(
            Math.abs(playerX - line1),
            Math.abs(playerX - line2),
            Math.abs(playerX - line3)
        )
    };
}

/**
 * Calculate zone multiplier based on relative position
 * Replaces static zone multipliers with dynamic ones
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} defensiveLines - Defensive line detection
 * @param {boolean} attackingRight - Attacking direction
 * @returns {number} Dynamic zone multiplier
 */
export function getDynamicZoneMultiplier(x, y, defensiveLines, attackingRight = true) {
    const zoneInfo = getRelativeZone(x, y, defensiveLines, attackingRight);

    switch (zoneInfo.zone) {
        case 'Z1':
            return 0.6;   // Build-up: lower value
        case 'Z2':
            return 0.9;   // Progression: medium value
        case 'Z3':
            return 1.2;   // Pre-finalization: elevated value
        case 'Z4':
            return 1.5;   // Finalization: highest value
        default:
            return 1.0;
    }
}

/**
 * Analyze pass destination relative to defensive lines
 * Used for "breaking lines" analysis from the paper
 * 
 * @param {Object} passer - Passer position
 * @param {Object} receiver - Receiver position  
 * @param {Object} defensiveLines - Defensive line detection
 * @param {boolean} attackingRight - Attacking direction
 * @returns {Object} Line-breaking analysis
 */
export function analyzeLineBreaking(passer, receiver, defensiveLines, attackingRight = true) {
    const passerZone = getRelativeZone(passer.x, passer.y, defensiveLines, attackingRight);
    const receiverZone = getRelativeZone(receiver.x, receiver.y, defensiveLines, attackingRight);

    const zoneValues = { Z1: 1, Z2: 2, Z3: 3, Z4: 4 };
    const zoneChange = zoneValues[receiverZone.zone] - zoneValues[passerZone.zone];

    let direction, linesBroken;

    if (zoneChange > 0) {
        direction = 'forward';
        linesBroken = zoneChange;
    } else if (zoneChange < 0) {
        direction = 'backward';
        linesBroken = Math.abs(zoneChange);
    } else {
        direction = 'lateral';
        linesBroken = 0;
    }

    return {
        passerZone: passerZone.zone,
        receiverZone: receiverZone.zone,
        direction,
        linesBroken,
        breaksLine: zoneChange > 0,
        fromPhase: passerZone.phase,
        toPhase: receiverZone.phase
    };
}
