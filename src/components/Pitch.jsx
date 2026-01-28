import React, { useRef, useEffect, useState, useCallback } from 'react';
import { getEPVColor, getEPVAlpha } from '../utils/epvModel.js';

/**
 * Pitch Component
 * Canvas-based football pitch visualization with players, ball, and EPV overlay
 */
export default function Pitch({
    frame,
    epvSurface,
    passOptions,
    hoveredPlayer,
    onPlayerHover,
    onPlayerClick,
    ballCarrier,
    showEPVOverlay = true
}) {
    const epvCanvasRef = useRef(null);
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Pitch dimensions in meters
    const PITCH_LENGTH = 105;
    const PITCH_WIDTH = 68;
    const PADDING = 40;

    // Handle resize
    useEffect(() => {
        const updateDimensions = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setDimensions({ width: rect.width, height: rect.height });
            }
        };

        updateDimensions();
        window.addEventListener('resize', updateDimensions);
        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    // Convert pitch coordinates to canvas coordinates
    const toCanvasCoords = useCallback((x, y) => {
        const { width, height } = dimensions;
        const pitchAspect = PITCH_LENGTH / PITCH_WIDTH;
        const canvasAspect = width / height;

        let drawWidth, drawHeight, offsetX, offsetY;

        if (canvasAspect > pitchAspect) {
            drawHeight = height - PADDING * 2;
            drawWidth = drawHeight * pitchAspect;
            offsetX = (width - drawWidth) / 2;
            offsetY = PADDING;
        } else {
            drawWidth = width - PADDING * 2;
            drawHeight = drawWidth / pitchAspect;
            offsetX = PADDING;
            offsetY = (height - drawHeight) / 2;
        }

        const scaleX = drawWidth / PITCH_LENGTH;
        const scaleY = drawHeight / PITCH_WIDTH;

        const canvasX = offsetX + (x + PITCH_LENGTH / 2) * scaleX;
        const canvasY = offsetY + (PITCH_WIDTH / 2 - y) * scaleY;

        return {
            x: canvasX,
            y: canvasY,
            scaleX,
            scaleY,
            drawWidth,
            drawHeight,
            offsetX,
            offsetY
        };
    }, [dimensions]);

    // Main draw function
    useEffect(() => {
        const canvas = canvasRef.current;
        const epvCanvas = epvCanvasRef.current;
        if (!canvas || !epvCanvas || !frame) return;

        const ctx = canvas.getContext('2d');
        const epvCtx = epvCanvas.getContext('2d');
        const { width, height } = dimensions;

        if (width === 0 || height === 0) return;

        // Set dimensions for both canvases
        canvas.width = width * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
        epvCanvas.width = width * window.devicePixelRatio;
        epvCanvas.height = height * window.devicePixelRatio;

        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        epvCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

        // Clear canvases
        ctx.clearRect(0, 0, width, height); // Transparent foreground

        // Background base
        epvCtx.fillStyle = '#1a472a';
        epvCtx.fillRect(0, 0, width, height);

        // Get transformation info
        const { scaleX, scaleY, drawWidth, drawHeight, offsetX, offsetY } = toCanvasCoords(0, 0);

        // Draw EPV overlay on background canvas (which is blurred via CSS)
        if (showEPVOverlay && epvSurface) {
            drawEPVOverlay(epvCtx, epvSurface, offsetX, offsetY, drawWidth, drawHeight);
        }

        // Draw pitch markings on foreground (sharp)
        drawPitch(ctx, offsetX, offsetY, drawWidth, drawHeight, showEPVOverlay);

        // Draw pass arrows
        if (passOptions && ballCarrier) {
            drawPassArrows(ctx, passOptions, ballCarrier, toCanvasCoords, hoveredPlayer);
        }

        // Draw players
        drawPlayers(ctx, frame.homePlayers, 'home', toCanvasCoords, ballCarrier, hoveredPlayer);
        drawPlayers(ctx, frame.awayPlayers, 'away', toCanvasCoords, ballCarrier, hoveredPlayer);

        // Draw ball
        if (frame.ball) {
            drawBall(ctx, frame.ball, toCanvasCoords);
        }

    }, [frame, dimensions, epvSurface, passOptions, hoveredPlayer, ballCarrier, showEPVOverlay, toCanvasCoords]);

    // Mouse move handler for hover detection
    const handleMouseMove = useCallback((e) => {
        if (!frame) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Check all players for hover
        const allPlayers = [
            ...frame.homePlayers.map(p => ({ ...p, team: 'home' })),
            ...frame.awayPlayers.map(p => ({ ...p, team: 'away' }))
        ];

        let found = null;
        for (const player of allPlayers) {
            const { x, y, scaleX } = toCanvasCoords(player.x, player.y);
            const radius = 12;
            const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2));

            if (dist < radius + 5) {
                found = player;
                break;
            }
        }

        if (onPlayerHover) {
            onPlayerHover(found);
        }
    }, [frame, toCanvasCoords, onPlayerHover]);

    const handleClick = useCallback((e) => {
        if (!frame) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const allPlayers = [
            ...frame.homePlayers.map(p => ({ ...p, team: 'home' })),
            ...frame.awayPlayers.map(p => ({ ...p, team: 'away' }))
        ];

        for (const player of allPlayers) {
            const { x, y } = toCanvasCoords(player.x, player.y);
            const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2));

            if (dist < 17) {
                if (onPlayerClick) onPlayerClick(player);
                break;
            }
        }
    }, [frame, toCanvasCoords, onPlayerClick]);

    return (
        <div ref={containerRef} className="pitch-wrapper">
            {/* Blurred Background Canvas for Heatmap */}
            <canvas
                ref={epvCanvasRef}
                className="pitch-canvas"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 0,
                    filter: 'blur(15px)', // Strong blur for heatmap effect
                    transform: 'scale(1.05)', // Slightly scale up to hide blurred edges
                    opacity: showEPVOverlay ? 1 : 0
                }}
            />
            {/* Sharp Foreground Canvas for Players/Lines */}
            <canvas
                ref={canvasRef}
                className="pitch-canvas"
                onMouseMove={handleMouseMove}
                onClick={handleClick}
                style={{
                    position: 'relative',
                    zIndex: 1,
                    cursor: hoveredPlayer ? 'pointer' : 'default'
                }}
            />
        </div>
    );
}

// Helper: Draw pitch markings
function drawPitch(ctx, offsetX, offsetY, width, height, transparentBackground = false) {
    if (!transparentBackground) {
        // Pitch background
        const gradient = ctx.createLinearGradient(offsetX, offsetY, offsetX, offsetY + height);
        gradient.addColorStop(0, '#1a472a');
        gradient.addColorStop(0.5, '#1f5132');
        gradient.addColorStop(1, '#1a472a');

        ctx.fillStyle = gradient;
        ctx.fillRect(offsetX, offsetY, width, height);

        // Pitch stripes (grass pattern)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
        const stripeWidth = width / 10;
        for (let i = 0; i < 10; i += 2) {
            ctx.fillRect(offsetX + i * stripeWidth, offsetY, stripeWidth, height);
        }
    }

    // Line style
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer boundary
    ctx.strokeRect(offsetX, offsetY, width, height);

    // Center line
    ctx.beginPath();
    ctx.moveTo(offsetX + width / 2, offsetY);
    ctx.lineTo(offsetX + width / 2, offsetY + height);
    ctx.stroke();

    // Center circle
    const centerCircleRadius = height * (9.15 / 68);
    ctx.beginPath();
    ctx.arc(offsetX + width / 2, offsetY + height / 2, centerCircleRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Center spot
    ctx.beginPath();
    ctx.arc(offsetX + width / 2, offsetY + height / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fill();

    // Penalty areas (both sides)
    const penaltyAreaWidth = width * (16.5 / 105);
    const penaltyAreaHeight = height * (40.3 / 68);
    const penaltyAreaY = offsetY + (height - penaltyAreaHeight) / 2;

    // Left penalty area
    ctx.strokeRect(offsetX, penaltyAreaY, penaltyAreaWidth, penaltyAreaHeight);

    // Right penalty area
    ctx.strokeRect(offsetX + width - penaltyAreaWidth, penaltyAreaY, penaltyAreaWidth, penaltyAreaHeight);

    // Goal areas
    const goalAreaWidth = width * (5.5 / 105);
    const goalAreaHeight = height * (18.32 / 68);
    const goalAreaY = offsetY + (height - goalAreaHeight) / 2;

    ctx.strokeRect(offsetX, goalAreaY, goalAreaWidth, goalAreaHeight);
    ctx.strokeRect(offsetX + width - goalAreaWidth, goalAreaY, goalAreaWidth, goalAreaHeight);

    // Penalty spots
    const penaltySpotX = width * (11 / 105);
    ctx.beginPath();
    ctx.arc(offsetX + penaltySpotX, offsetY + height / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(offsetX + width - penaltySpotX, offsetY + height / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Penalty arcs
    const penaltyArcRadius = height * (9.15 / 68);
    ctx.beginPath();
    ctx.arc(offsetX + penaltySpotX, offsetY + height / 2, penaltyArcRadius, -0.93, 0.93);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(offsetX + width - penaltySpotX, offsetY + height / 2, penaltyArcRadius, Math.PI - 0.93, Math.PI + 0.93);
    ctx.stroke();

    // Goals
    const goalWidth = width * (2 / 105);
    const goalHeight = height * (7.32 / 68);
    const goalY = offsetY + (height - goalHeight) / 2;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(offsetX - goalWidth, goalY, goalWidth, goalHeight);
    ctx.fillRect(offsetX + width, goalY, goalWidth, goalHeight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(offsetX - goalWidth, goalY, goalWidth, goalHeight);
    ctx.strokeRect(offsetX + width, goalY, goalWidth, goalHeight);
}

// Helper: Draw EPV overlay
function drawEPVOverlay(ctx, epvSurface, offsetX, offsetY, width, height) {
    const { grid, gridWidth, gridHeight } = epvSurface;

    const cellWidth = width / gridWidth;
    const cellHeight = height / gridHeight;

    for (let yi = 0; yi < gridHeight; yi++) {
        for (let xi = 0; xi < gridWidth; xi++) {
            const epv = grid[yi][xi];
            const color = getEPVColor(epv);
            const alpha = getEPVAlpha(epv);

            ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
            ctx.fillRect(
                offsetX + xi * cellWidth,
                offsetY + (gridHeight - 1 - yi) * cellHeight,
                cellWidth + 0.5,
                cellHeight + 0.5
            );
        }
    }
}

// Helper: Draw players
function drawPlayers(ctx, players, team, toCanvasCoords, ballCarrier, hoveredPlayer) {
    const teamColor = team === 'home' ? '#3b82f6' : '#ef4444';
    const teamColorLight = team === 'home' ? '#60a5fa' : '#f87171';

    players.forEach(player => {
        const { x, y } = toCanvasCoords(player.x, player.y);
        const radius = 12;

        const isBallCarrier = ballCarrier &&
            (player.id === ballCarrier.id || player.jerseyNum === ballCarrier.jerseyNum);
        const isHovered = hoveredPlayer &&
            (player.id === hoveredPlayer.id || player.jerseyNum === hoveredPlayer.jerseyNum);

        // Outer glow for ball carrier
        if (isBallCarrier) {
            ctx.beginPath();
            ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(251, 191, 36, 0.4)';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(251, 191, 36, 0.6)';
            ctx.fill();
        }

        // Hover effect
        if (isHovered && !isBallCarrier) {
            ctx.beginPath();
            ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(139, 92, 246, 0.5)';
            ctx.fill();
        }

        // Player circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);

        const gradient = ctx.createRadialGradient(x - 3, y - 3, 0, x, y, radius);
        gradient.addColorStop(0, teamColorLight);
        gradient.addColorStop(1, teamColor);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Border
        ctx.strokeStyle = isBallCarrier ? '#fbbf24' : 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = isBallCarrier ? 3 : 2;
        ctx.stroke();

        // Jersey number
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(player.jerseyNum, x, y);
    });
}

// Helper: Draw ball with z-axis visualization
function drawBall(ctx, ball, toCanvasCoords) {
    const { x, y } = toCanvasCoords(ball.x, ball.y);

    // Z-axis (height) affects size and shadow
    // Typical z values: 0 (on ground) to ~3m (high ball)
    const z = ball.z || 0;
    const maxHeight = 3; // Maximum expected height in meters
    const normalizedZ = Math.min(z / maxHeight, 1);

    // Ball size increases when in air (perspective effect)
    const baseRadius = 6;
    const heightBonus = normalizedZ * 4; // Up to 4px larger when high
    const radius = baseRadius + heightBonus;

    // Shadow offset increases with height
    const baseShadowOffset = 2;
    const shadowOffset = baseShadowOffset + normalizedZ * 12;

    // Shadow becomes more diffuse and larger with height
    const shadowBlur = normalizedZ * 8;
    const shadowAlpha = Math.max(0.15, 0.4 - normalizedZ * 0.25);
    const shadowRadius = radius * (0.8 + normalizedZ * 0.4);

    // Draw shadow (under the ball, offset by height)
    ctx.save();
    if (shadowBlur > 0) {
        ctx.filter = `blur(${shadowBlur}px)`;
    }
    ctx.beginPath();
    ctx.ellipse(
        x + shadowOffset * 0.5,
        y + shadowOffset,
        shadowRadius * 1.2,
        shadowRadius * 0.6,
        0, 0, Math.PI * 2
    );
    ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
    ctx.fill();
    ctx.restore();

    // Draw ball (higher balls appear slightly above their ground position)
    const visualY = y - normalizedZ * 8; // Ball appears to float up

    ctx.beginPath();
    ctx.arc(x, visualY, radius, 0, Math.PI * 2);

    // Gradient for 3D ball effect
    const gradient = ctx.createRadialGradient(
        x - radius * 0.3,
        visualY - radius * 0.3,
        0,
        x,
        visualY,
        radius
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.5, '#f0f0f0');
    gradient.addColorStop(1, '#cccccc');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Ball outline
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Ball panel lines for visual flair (soccer ball pattern hint)
    if (radius > 7) {
        ctx.strokeStyle = 'rgba(50, 50, 50, 0.3)';
        ctx.lineWidth = 0.5;

        // Simple pentagon hint
        ctx.beginPath();
        ctx.arc(x, visualY, radius * 0.4, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Height indicator (only when ball is significantly in air)
    if (z > 0.5) {
        const heightText = z.toFixed(1) + 'm';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText(heightText, x, visualY - radius - 5);
    }
}

// Helper: Draw pass arrows
function drawPassArrows(ctx, passOptions, ballCarrier, toCanvasCoords, hoveredPlayer) {
    const from = toCanvasCoords(ballCarrier.x, ballCarrier.y);

    passOptions.forEach((option, index) => {
        const to = toCanvasCoords(option.target.x, option.target.y);
        const isHovered = hoveredPlayer &&
            (option.target.id === hoveredPlayer.id || option.target.jerseyNum === hoveredPlayer.jerseyNum);

        // Get color based on EPVA
        let color;
        const epva = option.epvAdded;
        if (epva > 0.05) color = '#22c55e';
        else if (epva > 0) color = '#86efac';
        else if (epva > -0.02) color = '#eab308';
        else if (epva > -0.05) color = '#f97316';
        else color = '#ef4444';

        const alpha = isHovered ? 1 : 0.4;
        const lineWidth = isHovered ? 4 : 2;

        // Draw arrow line
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        // Arrow head
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const headLength = isHovered ? 12 : 8;

        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(
            to.x - headLength * Math.cos(angle - Math.PI / 6),
            to.y - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            to.x - headLength * Math.cos(angle + Math.PI / 6),
            to.y - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        ctx.globalAlpha = 1;
    });
}
