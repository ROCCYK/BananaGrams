import { useDroppable } from '@dnd-kit/core';
import { useRef, useState } from 'react';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.2;
const ZOOM_STEP = 0.12;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function Board({ children, camera, setCamera, panMode, setPanMode }) {
    const { isOver, setNodeRef } = useDroppable({
        id: 'board-droppable',
    });
    const containerRef = useRef(null);
    const [isPanning, setIsPanning] = useState(false);
    const panStateRef = useRef({
        pointerId: null,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
    });

    const zoomAtPoint = (nextScale, clientX, clientY) => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const px = clientX - rect.left;
        const py = clientY - rect.top;

        setCamera((prev) => {
            const clampedScale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
            const worldX = (px - prev.x) / prev.scale;
            const worldY = (py - prev.y) / prev.scale;

            return {
                x: px - worldX * clampedScale,
                y: py - worldY * clampedScale,
                scale: clampedScale,
            };
        });
    };

    const handleWheel = (event) => {
        if (!panMode) return;
        event.preventDefault();
        const zoomDelta = -event.deltaY * 0.0015;
        const nextScale = camera.scale * (1 + zoomDelta);
        zoomAtPoint(nextScale, event.clientX, event.clientY);
    };

    const handlePointerDown = (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('.camera-controls')) return;
        if (!panMode && event.target.closest('.tile')) return;

        event.preventDefault();
        setIsPanning(true);
        panStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: camera.x,
            originY: camera.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event) => {
        if (!isPanning || panStateRef.current.pointerId !== event.pointerId) return;

        event.preventDefault();
        const dx = event.clientX - panStateRef.current.startX;
        const dy = event.clientY - panStateRef.current.startY;

        setCamera((prev) => ({
            ...prev,
            x: panStateRef.current.originX + dx,
            y: panStateRef.current.originY + dy,
        }));
    };

    const handlePointerUp = (event) => {
        if (panStateRef.current.pointerId !== event.pointerId) return;
        setIsPanning(false);
        panStateRef.current.pointerId = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const style = {
        flex: 1,
        position: 'relative',
        opacity: isOver ? 0.9 : 1,
    };

    return (
        <div
            ref={(node) => {
                setNodeRef(node);
                containerRef.current = node;
            }}
            style={style}
            className={`board-container ${isPanning ? 'panning' : ''}`}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        >
            <div className="camera-controls">
                <button
                    type="button"
                    className={panMode ? 'active' : ''}
                    onClick={() => setPanMode((prev) => !prev)}
                >
                    Tile Lock
                </button>
                <button
                    type="button"
                    disabled={!panMode}
                    onClick={() => setCamera((prev) => ({ ...prev, scale: clamp(prev.scale + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM) }))}
                >
                    +
                </button>
                <button
                    type="button"
                    disabled={!panMode}
                    onClick={() => setCamera((prev) => ({ ...prev, scale: clamp(prev.scale - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM) }))}
                >
                    -
                </button>
                <button type="button" disabled={!panMode} onClick={() => setCamera({ x: 0, y: 0, scale: 1 })}>Reset</button>
            </div>
            <div
                className="camera-scene"
                style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
            >
                {children}
            </div>
        </div>
    );
}
