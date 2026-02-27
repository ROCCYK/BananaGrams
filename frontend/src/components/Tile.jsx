import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

export function Tile({ id, letter, left, top, revealed, onReveal, dragDisabled = false }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: id,
        data: { id, letter },
        disabled: dragDisabled
    });

    const style = {
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 10 : 1,
        opacity: isDragging ? 0 : 1,
        cursor: dragDisabled ? 'default' : (isDragging ? 'grabbing' : 'grab'),
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...(dragDisabled ? {} : listeners)}
            {...(dragDisabled ? {} : attributes)}
            onClick={(event) => {
                if (!dragDisabled && event.button === 0 && !isDragging && !revealed && typeof onReveal === 'function') {
                    onReveal(id);
                }
            }}
            className={`tile ${isDragging ? 'dragging' : ''} ${revealed ? '' : 'facedown'}`}
        >
            {revealed ? letter : ''}
        </div>
    );
}
