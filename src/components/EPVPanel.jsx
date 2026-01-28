import React from 'react';
import { formatSuccessProbability } from '../utils/passEvaluator.js';

/**
 * EPV Panel Component
 * Displays EPV information and pass options
 */
export default function EPVPanel({
    currentEPV,
    hoveredPlayer,
    hoveredPlayerEPV,
    passOptions,
    ballCarrier,
    onPassOptionHover
}) {
    const epvAdded = hoveredPlayerEPV !== null ? hoveredPlayerEPV - currentEPV : null;

    // Find the hovered pass option for additional info
    const hoveredOption = passOptions?.find(opt =>
        hoveredPlayer && (opt.target.id === hoveredPlayer.id || opt.target.jerseyNum === hoveredPlayer.jerseyNum)
    );

    return (
        <div className="epv-panel">
            {/* Current EPV */}
            <div className="epv-panel__section">
                <span className="epv-panel__label">Current Possession Value</span>
                <span className="epv-panel__value epv-panel__value--current">
                    {(currentEPV * 100).toFixed(1)}%
                </span>
                {ballCarrier && (
                    <span className="epv-panel__subtext">
                        Ball: #{ballCarrier.jerseyNum}
                    </span>
                )}
            </div>

            {/* Hovered Player EPV */}
            {hoveredPlayer && hoveredPlayerEPV !== null && (
                <>
                    <div className="epv-panel__section">
                        <span className="epv-panel__label">Pass to #{hoveredPlayer.jerseyNum}</span>
                        <span className="epv-panel__value epv-panel__value--target">
                            {(hoveredPlayerEPV * 100).toFixed(1)}%
                        </span>
                        {hoveredOption && (
                            <span className="epv-panel__subtext">
                                Success: {formatSuccessProbability(hoveredOption.successProbability).percent}%
                            </span>
                        )}
                    </div>

                    {/* EPV Delta */}
                    <div className={`epv-delta ${epvAdded >= 0 ? 'epv-delta--positive' : 'epv-delta--negative'}`}>
                        <span className="epv-delta__arrow">
                            {epvAdded >= 0 ? '↑' : '↓'}
                        </span>
                        <div className="epv-delta__content">
                            <span className="epv-delta__label">EPV Added</span>
                            <span className={`epv-delta__value ${epvAdded >= 0 ? 'epv-panel__value--positive' : 'epv-panel__value--negative'}`}>
                                {epvAdded >= 0 ? '+' : ''}{(epvAdded * 100).toFixed(2)}%
                            </span>
                        </div>
                    </div>
                </>
            )}

            {/* Top Pass Options */}
            {passOptions && passOptions.length > 0 && (
                <div className="epv-panel__section">
                    <span className="epv-panel__label">Pass Options (by EPVA)</span>
                    <div className="pass-options">
                        {passOptions.slice(0, 6).map((option, index) => {
                            const epvaClass = option.epvAdded > 0 ? 'epv-panel__value--positive' :
                                option.epvAdded < -0.02 ? 'epv-panel__value--negative' : '';
                            const isHovered = hoveredPlayer &&
                                (option.target.id === hoveredPlayer.id || option.target.jerseyNum === hoveredPlayer.jerseyNum);

                            return (
                                <div
                                    key={option.target.id || option.target.jerseyNum}
                                    className={`pass-option ${index === 0 ? 'pass-option--best' : ''} ${isHovered ? 'pass-option--hovered' : ''}`}
                                    onMouseEnter={() => onPassOptionHover && onPassOptionHover(option.target)}
                                    onMouseLeave={() => onPassOptionHover && onPassOptionHover(null)}
                                >
                                    <span className="pass-option__rank">{index + 1}</span>
                                    <span className="pass-option__player">
                                        #{option.target.jerseyNum}
                                    </span>
                                    <span className={`pass-option__epva ${epvaClass}`}>
                                        {option.epvAdded >= 0 ? '+' : ''}{(option.epvAdded * 100).toFixed(2)}%
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Legend */}
            <div className="epv-panel__section" style={{ marginTop: 'auto' }}>
                <span className="epv-panel__label">EPV Scale</span>
                <div style={{
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'center',
                    marginTop: '0.5rem'
                }}>
                    <div style={{
                        width: '100%',
                        height: '8px',
                        borderRadius: '4px',
                        background: 'linear-gradient(to right, #1e40af, #ffffff, #dc2626)'
                    }} />
                </div>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    marginTop: '0.25rem'
                }}>
                    <span>Low</span>
                    <span>High</span>
                </div>
            </div>
        </div>
    );
}
