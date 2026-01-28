import React, { useState, useEffect, useCallback, useRef } from 'react';
import Pitch from './components/Pitch.jsx';
import EPVPanel from './components/EPVPanel.jsx';
import PlaybackControls from './components/PlaybackControls.jsx';

import {
    loadEventData,
    extractFramesFromEvents,
    findBallCarrier,
    getTeammates,
    getOpponents
} from './utils/dataLoader.js';
import { generateEPVSurface, getEPVAt, calculateEPV } from './utils/epvModel.js';
import { findPassOptions } from './utils/passEvaluator.js';

/**
 * Main App Component
 * Football EPV Analytics Dashboard
 */
export default function App() {
    // Data state
    const [frames, setFrames] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const [dataLoaded, setDataLoaded] = useState(false);

    // View mode state: 'both', 'home', 'away'
    const [viewMode, setViewMode] = useState('both');
    // Pitch style: 'heatmap' or 'tactical'
    const [pitchStyle, setPitchStyle] = useState('heatmap');

    // Playback state
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const playIntervalRef = useRef(null);

    // Hover state
    const [hoveredPlayer, setHoveredPlayer] = useState(null);

    // Upload modal state
    const [showUploadModal, setShowUploadModal] = useState(false);

    // Computed state
    const [epvSurface, setEpvSurface] = useState(null);
    const [passOptions, setPassOptions] = useState([]);
    const [ballCarrier, setBallCarrier] = useState(null);
    const [currentEPV, setCurrentEPV] = useState(0);

    // Handle data loaded from file upload or demo
    const handleDataLoaded = useCallback(async (data, dataType) => {
        setLoading(true);
        setError(null);

        try {
            let processedFrames;

            if (dataType === 'demo') {
                // Load demo data from public folder
                const eventData = await loadEventData('/sample event data.json');
                if (!eventData || eventData.length === 0) {
                    throw new Error('Demo data not found. Please upload your own data.');
                }
                processedFrames = extractFramesFromEvents(eventData);
            } else if (dataType === 'event') {
                // Process uploaded event data
                processedFrames = extractFramesFromEvents(data);
            } else if (dataType === 'tracking') {
                // Process uploaded tracking data
                processedFrames = processTrackingData(data);
            }

            if (!processedFrames || processedFrames.length === 0) {
                throw new Error('No valid frames found in the data');
            }

            setFrames(processedFrames);
            setCurrentFrameIndex(0);
            setDataLoaded(true);
            setLoading(false);
        } catch (err) {
            console.error('Failed to load data:', err);
            setError(err.message);
            setLoading(false);
        }
    }, []);

    // Process tracking data (JSONL format)
    const processTrackingData = useCallback((data) => {
        return data.map((frame, index) => ({
            frameIndex: index,
            timestamp: frame.periodElapsedTime || index / 25,
            gameClock: Math.floor(frame.periodGameClockTime || 0),
            period: frame.period || 1,
            pitchLength: 105,
            pitchWidth: 68,
            homeAttackingRight: true,
            homeTeam: { name: 'Home', id: 1 },
            awayTeam: { name: 'Away', id: 2 },
            homePlayers: (frame.homePlayers || frame.homePlayersSmoothed || []).map((p, i) => ({
                id: `home_${p.jerseyNum || i}`,
                jerseyNum: p.jerseyNum || i + 1,
                x: p.x,
                y: p.y,
                speed: p.speed || 0,
                position: p.positionGroupType || 'CM',
                confidence: p.confidence,
                vx: 0,
                vy: 0
            })),
            awayPlayers: (frame.awayPlayers || frame.awayPlayersSmoothed || []).map((p, i) => ({
                id: `away_${p.jerseyNum || i}`,
                jerseyNum: p.jerseyNum || i + 1,
                x: p.x,
                y: p.y,
                speed: p.speed || 0,
                position: p.positionGroupType || 'CM',
                confidence: p.confidence,
                vx: 0,
                vy: 0
            })),
            ball: (frame.balls && frame.balls.length > 0) ? {
                x: frame.balls[0].x,
                y: frame.balls[0].y,
                z: frame.balls[0].z || 0
            } : (frame.ballsSmoothed && frame.ballsSmoothed.length > 0) ? {
                x: frame.ballsSmoothed[0].x,
                y: frame.ballsSmoothed[0].y,
                z: frame.ballsSmoothed[0].z || 0
            } : frame.ball ? {
                x: frame.ball.x ?? frame.ball[0]?.x ?? 0,
                y: frame.ball.y ?? frame.ball[0]?.y ?? 0,
                z: frame.ball.z ?? frame.ball[0]?.z ?? 0
            } : { x: 0, y: 0, z: 0 },
            eventType: 'TRACKING',
            possessionTeam: 'home'
        }));
    }, []);

    // Get current frame
    const currentFrame = frames[currentFrameIndex];

    // Playback loop using requestAnimationFrame
    useEffect(() => {
        let animationFrameId;
        let lastFrameTime = 0;

        if (isPlaying) {
            const frameDuration = 1000 / (25 * playbackSpeed);

            const animate = (timestamp) => {
                if (!lastFrameTime) lastFrameTime = timestamp;

                const elapsed = timestamp - lastFrameTime;

                if (elapsed >= frameDuration) {
                    setCurrentFrameIndex(prev => {
                        if (prev >= frames.length - 1) {
                            setIsPlaying(false);
                            return prev;
                        }
                        return prev + 1;
                    });
                    lastFrameTime = timestamp - (elapsed % frameDuration);
                }

                animationFrameId = requestAnimationFrame(animate);
            };

            animationFrameId = requestAnimationFrame(animate);
        }

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [isPlaying, playbackSpeed, frames.length]);

    // Calculate EPV and pass options when frame changes
    useEffect(() => {
        if (!currentFrame) return;

        // Find ball carrier
        const carrier = findBallCarrier(currentFrame);
        setBallCarrier(carrier);

        if (!carrier) {
            setCurrentEPV(0);
            setPassOptions([]);

            // Low resolution during playback to prevent lag
            const resolution = isPlaying ? 4 : 2;

            const gameState = {
                teamPlayers: currentFrame.homePlayers,
                opponentPlayers: currentFrame.awayPlayers,
                ball: currentFrame.ball,
                attackingRight: currentFrame.homeAttackingRight
            };

            // Use efficient resolution
            const surface = generateEPVSurface(gameState, {
                pitchLength: currentFrame.pitchLength || 105,
                pitchWidth: currentFrame.pitchWidth || 68,
                resolution
            });
            setEpvSurface(surface);
            return;
        }

        // Check if we should show EPV based on view mode
        let shouldShowEPV = true;
        if (viewMode === 'home' && carrier.team !== 'home') shouldShowEPV = false;
        if (viewMode === 'away' && carrier.team !== 'away') shouldShowEPV = false;

        if (!shouldShowEPV) {
            setEpvSurface(null);
            setCurrentEPV(0);
            setPassOptions([]);
            return;
        }

        // Determine teams based on who has the ball
        const teamPlayers = carrier.team === 'home' ? currentFrame.homePlayers : currentFrame.awayPlayers;
        const opponentPlayers = carrier.team === 'home' ? currentFrame.awayPlayers : currentFrame.homePlayers;
        const attackingRight = carrier.team === 'home' ? currentFrame.homeAttackingRight : !currentFrame.homeAttackingRight;

        const gameState = {
            teamPlayers,
            opponentPlayers,
            ball: currentFrame.ball,
            attackingRight
        };

        // Dynamic resolution based on playback state
        // 4m grid during playback (fast) vs 2m grid when paused (detailed)
        const resolution = isPlaying ? 4 : 2;

        const surface = generateEPVSurface(gameState, {
            pitchLength: currentFrame.pitchLength || 105,
            pitchWidth: currentFrame.pitchWidth || 68,
            resolution
        });
        setEpvSurface(surface);

        // Calculate current EPV
        const epv = getEPVAt(surface, carrier.x, carrier.y);
        setCurrentEPV(epv);

        // Skip pass calculation during high-speed playback for performance
        if (isPlaying && playbackSpeed > 1) {
            setPassOptions([]);
        } else {
            // Find pass options
            const teammates = getTeammates(currentFrame, carrier);
            const options = findPassOptions(carrier, teammates, gameState);
            setPassOptions(options);
        }

    }, [currentFrame, currentFrameIndex, isPlaying, playbackSpeed, viewMode]);

    // Playback controls
    const handlePlay = useCallback(() => {
        setIsPlaying(true);
    }, []);

    const handlePause = useCallback(() => {
        setIsPlaying(false);
    }, []);

    const handleStepForward = useCallback(() => {
        setCurrentFrameIndex(prev => Math.min(prev + 1, frames.length - 1));
    }, [frames.length]);

    const handleStepBackward = useCallback(() => {
        setCurrentFrameIndex(prev => Math.max(prev - 1, 0));
    }, []);

    const handleSeek = useCallback((frameIndex) => {
        setCurrentFrameIndex(frameIndex);
    }, []);

    const handleSpeedChange = useCallback((speed) => {
        setPlaybackSpeed(speed);
    }, []);

    // Reset to file upload
    const handleReset = useCallback(() => {
        setDataLoaded(false);
        setFrames([]);
        setCurrentFrameIndex(0);
        setIsPlaying(false);
        setEpvSurface(null);
        setPassOptions([]);
        setBallCarrier(null);
        setViewMode('both');
    }, []);

    // Handle file upload from dashboard (inline)
    const handleFileUpload = useCallback(async (event, dataType) => {
        const file = event.target.files[0];
        if (!file) return;

        setLoading(true);
        setError(null);

        try {
            let data = [];

            if (file.name.endsWith('.jsonl')) {
                // Stream read for large JSONL files
                const stream = file.stream();
                const reader = stream.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed) {
                            try {
                                data.push(JSON.parse(trimmed));
                            } catch (e) { /* skip invalid */ }
                        }
                    }
                }

                if (buffer && buffer.trim()) {
                    try {
                        data.push(JSON.parse(buffer));
                    } catch (e) { /* skip */ }
                }
            } else {
                const text = await file.text();
                data = JSON.parse(text);
            }

            if (!data || (Array.isArray(data) && data.length === 0)) {
                throw new Error('No valid data found in file');
            }

            handleDataLoaded(data, dataType);
        } catch (err) {
            console.error('Error parsing file:', err);
            setError(err.message);
            setLoading(false);
        }
    }, [handleDataLoaded]);

    // Player hover handler
    const handlePlayerHover = useCallback((player) => {
        setHoveredPlayer(player);
    }, []);

    // Get hovered player EPV
    const getHoveredPlayerEPV = useCallback(() => {
        if (!hoveredPlayer || !epvSurface || !ballCarrier) return null;

        // Check if hovered player is a teammate (valid pass target)
        const isTeammate = ballCarrier.team === hoveredPlayer.team &&
            (hoveredPlayer.id !== ballCarrier.id && hoveredPlayer.jerseyNum !== ballCarrier.jerseyNum);

        if (!isTeammate) return null;

        // Find in pass options
        const option = passOptions.find(opt =>
            opt.target.id === hoveredPlayer.id || opt.target.jerseyNum === hoveredPlayer.jerseyNum
        );

        if (option) {
            return option.expectedValue;
        }

        // Fallback: calculate directly
        return getEPVAt(epvSurface, hoveredPlayer.x, hoveredPlayer.y);
    }, [hoveredPlayer, epvSurface, ballCarrier, passOptions]);

    // Loading state with Material UI style progress
    const LoadingOverlay = () => (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
        }}>
            <div style={{
                background: '#1e293b',
                padding: '2rem',
                borderRadius: '12px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                width: '320px',
                textAlign: 'center'
            }}>
                <div style={{ marginBottom: '1rem', color: '#fff', fontSize: '1.1rem', fontWeight: 500 }}>
                    Processing Game Data...
                </div>
                <div style={{
                    height: '4px',
                    width: '100%',
                    background: '#334155',
                    borderRadius: '2px',
                    overflow: 'hidden'
                }}>
                    <div className="loading-bar-anim" style={{
                        height: '100%',
                        background: '#3b82f6',
                        width: '50%',
                        borderRadius: '2px'
                    }}></div>
                </div>
                <div style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#94a3b8' }}>
                    This may take a moment for large files
                </div>
            </div>
            <style>{`
                @keyframes loading-anim {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(200%); }
                }
                .loading-bar-anim {
                    animation: loading-anim 1.5s infinite linear;
                }
            `}</style>
        </div>
    );

    // Get team names
    const homeTeamName = currentFrame?.homeTeam?.name || 'Home';
    const awayTeamName = currentFrame?.awayTeam?.name || 'Away';

    return (
        <div className="dashboard">
            {loading && <LoadingOverlay />}

            {/* Header */}
            <header className="dashboard__header" style={{
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                zIndex: 50
            }}>
                <h1 className="dashboard__title">⚽ EPV Analytics Dashboard</h1>

                {/* Team Focus Controls */}
                <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-tertiary)', padding: '4px', borderRadius: '8px' }}>
                    <button
                        onClick={() => setViewMode('home')}
                        style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '6px',
                            border: 'none',
                            background: viewMode === 'home' ? 'var(--home-team)' : 'transparent',
                            color: viewMode === 'home' ? 'white' : 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            transition: 'all 0.2s'
                        }}
                    >
                        {homeTeamName}
                    </button>
                    <button
                        onClick={() => setViewMode('both')}
                        style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '6px',
                            border: 'none',
                            background: viewMode === 'both' ? 'var(--bg-secondary)' : 'transparent',
                            color: viewMode === 'both' ? 'var(--text-primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            border: viewMode === 'both' ? '1px solid var(--border-subtle)' : 'none',
                            transition: 'all 0.2s'
                        }}
                    >
                        Both
                    </button>
                    <button
                        onClick={() => setViewMode('away')}
                        style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '6px',
                            border: 'none',
                            background: viewMode === 'away' ? 'var(--away-team)' : 'transparent',
                            color: viewMode === 'away' ? 'white' : 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            transition: 'all 0.2s'
                        }}
                    >
                        {awayTeamName}
                    </button>
                </div>

                {/* Pitch Style Controls */}
                <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-tertiary)', padding: '4px', borderRadius: '8px', marginLeft: '1rem' }}>
                    <button
                        onClick={() => setPitchStyle('heatmap')}
                        style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '6px',
                            border: 'none',
                            background: pitchStyle === 'heatmap' ? 'var(--accent)' : 'transparent',
                            color: pitchStyle === 'heatmap' ? 'white' : 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            transition: 'all 0.2s'
                        }}
                    >
                        🔥 Heatmap
                    </button>
                    <button
                        onClick={() => setPitchStyle('tactical')}
                        style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '6px',
                            border: 'none',
                            background: pitchStyle === 'tactical' ? '#1f2937' : 'transparent',
                            color: pitchStyle === 'tactical' ? 'white' : 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            border: pitchStyle === 'tactical' ? '1px solid var(--border-subtle)' : 'none',
                            transition: 'all 0.2s'
                        }}
                    >
                        📋 Tactical
                    </button>
                </div>

                <div className="dashboard__teams">
                    <div className="team-badge">
                        <div className="team-badge__color team-badge__color--home"></div>
                        <span className="team-badge__name">{homeTeamName}</span>
                    </div>
                    <span style={{ color: 'var(--text-muted)' }}>vs</span>
                    <div className="team-badge">
                        <div className="team-badge__color team-badge__color--away"></div>
                        <span className="team-badge__name">{awayTeamName}</span>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    {currentFrame?.eventType && (
                        <span style={{
                            padding: '0.25rem 0.75rem',
                            background: 'var(--bg-tertiary)',
                            borderRadius: '4px',
                            fontSize: '0.875rem'
                        }}>
                            {currentFrame.eventType}
                        </span>
                    )}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setShowUploadModal(!showUploadModal)}
                            style={{
                                padding: '0.6rem 1.2rem',
                                background: '#3b82f6',
                                border: 'none',
                                borderRadius: '8px',
                                color: 'white',
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.5)',
                                transition: 'all 0.2s'
                            }}
                        >
                            ☁️ Upload Data
                        </button>
                        {showUploadModal && (
                            <div style={{
                                position: 'absolute',
                                top: '120%',
                                right: 0,
                                background: '#1e293b',
                                border: '1px solid #334155',
                                borderRadius: '12px',
                                padding: '0.5rem',
                                minWidth: '300px',
                                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
                                zIndex: 1000,
                                animation: 'fadeIn 0.2s ease-out'
                            }}>
                                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #334155', marginBottom: '0.5rem' }}>
                                    <h3 style={{ margin: 0, fontSize: '1rem', color: '#f1f5f9' }}>Data Source</h3>
                                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>Select your match data file</p>
                                </div>

                                <label style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    padding: '1rem',
                                    margin: '0.5rem',
                                    background: '#0f172a',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    border: '1px solid #334155',
                                    transition: 'background 0.2s'
                                }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#1e293b'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = '#0f172a'}
                                >
                                    <input
                                        type="file"
                                        accept=".json"
                                        style={{ display: 'none' }}
                                        onChange={(e) => {
                                            handleFileUpload(e, 'event');
                                            setShowUploadModal(false);
                                        }}
                                    />
                                    <div style={{ fontSize: '1.5rem' }}>📊</div>
                                    <div>
                                        <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.9rem' }}>Event Data</div>
                                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>JSON file with events</div>
                                    </div>
                                </label>

                                <label style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    padding: '1rem',
                                    margin: '0.5rem',
                                    background: '#0f172a',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    border: '1px solid #334155',
                                    transition: 'background 0.2s'
                                }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#1e293b'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = '#0f172a'}
                                >
                                    <input
                                        type="file"
                                        accept=".jsonl,.json"
                                        style={{ display: 'none' }}
                                        onChange={(e) => {
                                            handleFileUpload(e, 'tracking');
                                            setShowUploadModal(false);
                                        }}
                                    />
                                    <div style={{ fontSize: '1.5rem' }}>📍</div>
                                    <div>
                                        <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.9rem' }}>Tracking Data</div>
                                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>JSONL with frame data</div>
                                    </div>
                                </label>

                                <div style={{ borderTop: '1px solid #334155', margin: '0.5rem 0.5rem 0', padding: '0.75rem 0.25rem 0.25rem' }}>
                                    <button
                                        onClick={() => {
                                            handleDataLoaded(null, 'demo');
                                            setShowUploadModal(false);
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: '0.75rem',
                                            background: 'rgba(59, 130, 246, 0.1)',
                                            border: '1px dashed #3b82f6',
                                            borderRadius: '6px',
                                            color: '#60a5fa',
                                            cursor: 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: 500,
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
                                    >
                                        Load Sample Data
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="dashboard__main">
                {/* Pitch */}
                <div className="pitch-container">
                    <Pitch
                        frame={currentFrame}
                        epvSurface={epvSurface}
                        passOptions={passOptions}
                        hoveredPlayer={hoveredPlayer}
                        onPlayerHover={handlePlayerHover}
                        ballCarrier={ballCarrier}
                        showEPVOverlay={pitchStyle === 'heatmap'}
                    />
                </div>

                {/* EPV Panel */}
                <EPVPanel
                    currentEPV={currentEPV}
                    hoveredPlayer={hoveredPlayer}
                    hoveredPlayerEPV={getHoveredPlayerEPV()}
                    passOptions={passOptions}
                    ballCarrier={ballCarrier}
                    onPassOptionHover={handlePlayerHover}
                />
            </main>

            {/* Playback Controls */}
            <PlaybackControls
                currentFrame={currentFrameIndex}
                totalFrames={frames.length}
                isPlaying={isPlaying}
                playbackSpeed={playbackSpeed}
                gameClock={currentFrame?.gameClock || 0}
                period={currentFrame?.period || 1}
                onPlay={handlePlay}
                onPause={handlePause}
                onStepForward={handleStepForward}
                onStepBackward={handleStepBackward}
                onSeek={handleSeek}
                onSpeedChange={handleSpeedChange}
            />
        </div>
    );
}
