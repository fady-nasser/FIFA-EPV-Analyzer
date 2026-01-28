import React from 'react';
import { formatTime } from '../utils/dataLoader.js';

/**
 * Playback Controls Component
 * Timeline and playback buttons for navigating game frames
 */
export default function PlaybackControls({
    currentFrame,
    totalFrames,
    isPlaying,
    playbackSpeed,
    gameClock,
    period,
    onPlay,
    onPause,
    onStepForward,
    onStepBackward,
    onSeek,
    onSpeedChange
}) {
    const progress = totalFrames > 0 ? (currentFrame / (totalFrames - 1)) * 100 : 0;

    return (
        <div className="playback-controls">
            {/* Playback buttons */}
            <div className="playback-controls__buttons">
                <button
                    className="playback-btn"
                    onClick={onStepBackward}
                    title="Previous frame"
                >
                    ⏮
                </button>

                <button
                    className={`playback-btn ${isPlaying ? 'playback-btn--active' : ''}`}
                    onClick={isPlaying ? onPause : onPlay}
                    title={isPlaying ? 'Pause' : 'Play'}
                >
                    {isPlaying ? '⏸' : '▶'}
                </button>

                <button
                    className="playback-btn"
                    onClick={onStepForward}
                    title="Next frame"
                >
                    ⏭
                </button>
            </div>

            {/* Timeline */}
            <div className="playback-timeline">
                <input
                    type="range"
                    className="playback-timeline__slider"
                    min={0}
                    max={totalFrames - 1}
                    value={currentFrame}
                    onChange={(e) => onSeek(parseInt(e.target.value))}
                    style={{
                        background: `linear-gradient(to right, var(--accent) ${progress}%, var(--bg-tertiary) ${progress}%)`
                    }}
                />
                <div className="playback-timeline__time">
                    <span>Period {period} • {formatTime(gameClock)}</span>
                    <span>Frame {currentFrame + 1} / {totalFrames}</span>
                </div>
            </div>

            {/* Speed control */}
            <div className="playback-speed">
                <span className="playback-speed__label">Speed:</span>
                <select
                    className="playback-speed__select"
                    value={playbackSpeed}
                    onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
                >
                    <option value={0.25}>0.25x</option>
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                    <option value={4}>4x</option>
                </select>
            </div>
        </div>
    );
}
