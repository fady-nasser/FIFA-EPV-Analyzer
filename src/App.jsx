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

    // Dark mode state
    const [isDarkMode, setIsDarkMode] = useState(() => {
        const saved = localStorage.getItem('theme');
        return saved ? saved === 'dark' : true; // Default to dark
    });

    // Apply theme to document
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    }, [isDarkMode]);

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
                <h1 className="dashboard__title"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem', verticalAlign: 'middle' }}><circle cx="12" cy="12" r="10" /><path d="m4.93 4.93 4.24 4.24" /><path d="m14.83 9.17 4.24-4.24" /><path d="m14.83 14.83 4.24 4.24" /><path d="m9.17 14.83-4.24 4.24" /><path d="m12 2v4" /><path d="m12 18v4" /><path d="m2 12h4" /><path d="m18 12h4" /></svg>EPV Analytics Dashboard</h1>

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
                <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-tertiary)', padding: '4px', borderRadius: '12px', marginLeft: '1rem' }}>
                    <button
                        onClick={() => setPitchStyle('heatmap')}
                        style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '8px',
                            border: 'none',
                            background: pitchStyle === 'heatmap' ? 'var(--text-primary)' : 'transparent',
                            color: pitchStyle === 'heatmap' ? 'var(--bg-primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            transition: 'all 0.2s'
                        }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.35rem', verticalAlign: 'middle' }}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" /></svg>Heatmap
                    </button>
                    <button
                        onClick={() => setPitchStyle('tactical')}
                        style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '8px',
                            border: 'none',
                            background: pitchStyle === 'tactical' ? 'var(--text-primary)' : 'transparent',
                            color: pitchStyle === 'tactical' ? 'var(--bg-primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            transition: 'all 0.2s'
                        }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.35rem', verticalAlign: 'middle' }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /><line x1="10" x2="8" y1="9" y2="9" /></svg>Tactical
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
                    {/* Dark Mode Toggle */}
                    <button
                        onClick={() => setIsDarkMode(!isDarkMode)}
                        style={{
                            width: '40px',
                            height: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '12px',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                        title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    >
                        {isDarkMode ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="4" />
                                <path d="M12 2v2" />
                                <path d="M12 20v2" />
                                <path d="m4.93 4.93 1.41 1.41" />
                                <path d="m17.66 17.66 1.41 1.41" />
                                <path d="M2 12h2" />
                                <path d="M20 12h2" />
                                <path d="m6.34 17.66-1.41 1.41" />
                                <path d="m19.07 4.93-1.41 1.41" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                            </svg>
                        )}
                    </button>
                    {currentFrame?.eventType && (
                        <span style={{
                            padding: '0.25rem 0.75rem',
                            background: 'var(--bg-tertiary)',
                            borderRadius: '12px',
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
                                background: 'var(--accent)',
                                border: 'none',
                                borderRadius: '12px',
                                color: 'var(--bg-primary)',
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                transition: 'all 0.2s'
                            }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.35rem', verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></svg>Upload Data
                        </button>
                        {showUploadModal && (
                            <div style={{
                                position: 'absolute',
                                top: '120%',
                                right: 0,
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-medium)',
                                borderRadius: '16px',
                                padding: '0.5rem',
                                minWidth: '300px',
                                boxShadow: 'var(--shadow-lg)',
                                zIndex: 1000,
                                animation: 'fadeIn 0.2s ease-out'
                            }}>
                                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle)', marginBottom: '0.5rem' }}>
                                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>Data Source</h3>
                                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Select your match data file</p>
                                </div>

                                <label style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    padding: '1rem',
                                    margin: '0.5rem',
                                    background: 'var(--bg-tertiary)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    border: '1px solid var(--border-subtle)',
                                    transition: 'background 0.2s'
                                }}>
                                    <input
                                        type="file"
                                        accept=".json"
                                        style={{ display: 'none' }}
                                        onChange={(e) => {
                                            handleFileUpload(e, 'event');
                                            setShowUploadModal(false);
                                        }}
                                    />
                                    <div style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', color: 'var(--text-primary)' }}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" x2="18" y1="20" y2="10" /><line x1="12" x2="12" y1="20" y2="4" /><line x1="6" x2="6" y1="20" y2="14" /></svg></div>
                                    <div>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Event Data</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>JSON file with events</div>
                                    </div>
                                </label>

                                <label style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    padding: '1rem',
                                    margin: '0.5rem',
                                    background: 'var(--bg-tertiary)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    border: '1px solid var(--border-subtle)',
                                    transition: 'background 0.2s'
                                }}>
                                    <input
                                        type="file"
                                        accept=".jsonl,.json"
                                        style={{ display: 'none' }}
                                        onChange={(e) => {
                                            handleFileUpload(e, 'tracking');
                                            setShowUploadModal(false);
                                        }}
                                    />
                                    <div style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', color: 'var(--text-primary)' }}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg></div>
                                    <div>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Tracking Data</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>JSONL with frame data</div>
                                    </div>
                                </label>

                                <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '0.5rem 0.5rem 0', padding: '0.75rem 0.25rem 0.25rem' }}>
                                    <button
                                        onClick={() => {
                                            handleDataLoaded(null, 'demo');
                                            setShowUploadModal(false);
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: '0.75rem',
                                            background: 'var(--bg-tertiary)',
                                            border: '1px dashed var(--border-medium)',
                                            borderRadius: '12px',
                                            color: 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: 500,
                                            transition: 'all 0.2s'
                                        }}
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
