/**
 * Data Loader Utilities
 * Handles loading and parsing of event and tracking data
 */

/**
 * Load event data from JSON file
 * @param {string} path - Path to event data JSON
 * @returns {Promise<Array>} Parsed event data
 */
export async function loadEventData(path = '/sample event data.json') {
    try {
        const response = await fetch(path);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error loading event data:', error);
        return [];
    }
}

/**
 * Load tracking data from JSONL file
 * @param {string} path - Path to tracking JSONL
 * @returns {Promise<Array>} Array of frame objects
 */
export async function loadTrackingData(path = '/3844.jsonl/3844.jsonl') {
    try {
        const response = await fetch(path);
        const text = await response.text();
        const lines = text.trim().split('\n');
        return lines.map(line => JSON.parse(line));
    } catch (error) {
        console.error('Error loading tracking data:', error);
        return [];
    }
}

/**
 * Extract unique frames from event data
 * Event data contains player positions at each event timestamp
 * @param {Array} eventData - Raw event data
 * @returns {Array} Processed frames with normalized structure
 */
export function extractFramesFromEvents(eventData) {
    return eventData.map((event, index) => {
        const stadium = event.stadiumMetadata || {};
        const pitchLength = stadium.pitchLength || 105;
        const pitchWidth = stadium.pitchWidth || 68;

        // Determine attacking direction for home team
        const homeAttackingRight = stadium.teamAttackingDirection === 'R';

        // Find ball carrier from event data
        let ballCarrierId = null;
        if (event.gameEvents?.playerId) {
            ballCarrierId = event.gameEvents.playerId;
        }

        return {
            frameIndex: index,
            timestamp: event.eventTime || event.startTime,
            gameClock: event.possessionEvents?.gameClock || 0,
            period: event.gameEvents?.period || 1,

            // Stadium info
            pitchLength,
            pitchWidth,
            homeAttackingRight,

            // Team info
            homeTeam: event.gameEvents?.homeTeam ?
                { name: event.gameEvents.teamName, id: event.gameEvents.teamId } :
                { name: 'Argentina', id: 364 },
            awayTeam: !event.gameEvents?.homeTeam ?
                { name: event.gameEvents?.teamName || 'France', id: event.gameEvents?.teamId || 363 } :
                { name: 'France', id: 363 },

            // Players
            homePlayers: (event.homePlayers || []).map(p => ({
                id: p.playerId,
                jerseyNum: p.jerseyNum,
                x: p.x,
                y: p.y,
                speed: p.speed || 0,
                position: p.positionGroupType,
                confidence: p.confidence,
                isBallCarrier: p.playerId === ballCarrierId && event.gameEvents?.homeTeam
            })),

            awayPlayers: (event.awayPlayers || []).map(p => ({
                id: p.playerId,
                jerseyNum: p.jerseyNum,
                x: p.x,
                y: p.y,
                speed: p.speed || 0,
                position: p.positionGroupType,
                confidence: p.confidence,
                isBallCarrier: p.playerId === ballCarrierId && !event.gameEvents?.homeTeam
            })),

            // Ball
            ball: event.ball?.[0] ? {
                x: event.ball[0].x,
                y: event.ball[0].y,
                z: event.ball[0].z || 0
            } : { x: 0, y: 0, z: 0 },

            // Event metadata
            eventType: event.gameEvents?.gameEventType,
            possessionTeam: event.gameEvents?.homeTeam ? 'home' : 'away',
            playerName: event.gameEvents?.playerName,

            // Pass info if available
            passInfo: event.possessionEvents?.possessionEventType === 'PA' ? {
                passerId: event.possessionEvents.passerPlayerId,
                passerName: event.possessionEvents.passerPlayerName,
                targetId: event.possessionEvents.targetPlayerId,
                targetName: event.possessionEvents.targetPlayerName,
                outcome: event.possessionEvents.passOutcomeType
            } : null
        };
    });
}

/**
 * Derive velocity vectors from consecutive frames
 * @param {Array} frames - Array of frame objects  
 * @param {number} fps - Frames per second (default 25)
 * @returns {Array} Frames with velocity data added
 */
export function deriveVelocities(frames, fps = 25) {
    const dt = 1 / fps;

    return frames.map((frame, i) => {
        if (i === 0) {
            // First frame: no previous data, set velocity to 0
            return {
                ...frame,
                homePlayers: frame.homePlayers.map(p => ({ ...p, vx: 0, vy: 0 })),
                awayPlayers: frame.awayPlayers.map(p => ({ ...p, vx: 0, vy: 0 }))
            };
        }

        const prevFrame = frames[i - 1];

        const addVelocity = (players, prevPlayers) => {
            return players.map(player => {
                const prevPlayer = prevPlayers.find(p => p.id === player.id || p.jerseyNum === player.jerseyNum);
                if (prevPlayer) {
                    const vx = (player.x - prevPlayer.x) / dt;
                    const vy = (player.y - prevPlayer.y) / dt;
                    return { ...player, vx, vy };
                }
                return { ...player, vx: 0, vy: 0 };
            });
        };

        return {
            ...frame,
            homePlayers: addVelocity(frame.homePlayers, prevFrame.homePlayers),
            awayPlayers: addVelocity(frame.awayPlayers, prevFrame.awayPlayers)
        };
    });
}

/**
 * Find ball carrier in a frame
 * @param {Object} frame - Frame object
 * @returns {Object|null} Ball carrier player object
 */
export function findBallCarrier(frame) {
    const ball = frame.ball;
    const allPlayers = [...frame.homePlayers, ...frame.awayPlayers];

    // First check if any player is marked as ball carrier
    const marked = allPlayers.find(p => p.isBallCarrier);
    if (marked) return { ...marked, team: frame.homePlayers.includes(marked) ? 'home' : 'away' };

    // Otherwise find closest player to ball
    let closest = null;
    let minDist = Infinity;

    allPlayers.forEach(player => {
        const dist = Math.sqrt(
            Math.pow(player.x - ball.x, 2) +
            Math.pow(player.y - ball.y, 2)
        );
        if (dist < minDist) {
            minDist = dist;
            closest = player;
        }
    });

    if (closest && minDist < 3) { // Within 3 meters
        return {
            ...closest,
            team: frame.homePlayers.some(p => p.id === closest.id) ? 'home' : 'away'
        };
    }

    return null;
}

/**
 * Get teammates of ball carrier
 * @param {Object} frame - Frame object
 * @param {Object} ballCarrier - Ball carrier object
 * @returns {Array} Array of teammate objects
 */
export function getTeammates(frame, ballCarrier) {
    if (!ballCarrier) return [];

    const team = ballCarrier.team === 'home' ? frame.homePlayers : frame.awayPlayers;
    return team.filter(p => p.id !== ballCarrier.id && p.jerseyNum !== ballCarrier.jerseyNum);
}

/**
 * Get opponents
 * @param {Object} frame - Frame object
 * @param {Object} ballCarrier - Ball carrier object
 * @returns {Array} Array of opponent objects
 */
export function getOpponents(frame, ballCarrier) {
    if (!ballCarrier) return [...frame.homePlayers, ...frame.awayPlayers];

    return ballCarrier.team === 'home' ? frame.awayPlayers : frame.homePlayers;
}

/**
 * Format time for display
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string (MM:SS)
 */
export function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
