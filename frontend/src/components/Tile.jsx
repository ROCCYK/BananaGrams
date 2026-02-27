import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

export function Tile({ id, letter, left, top, revealed, onReveal }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: id,
        data: { id, letter }
    });

    const style = {
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 10 : 1,
        opacity: isDragging ? 0.8 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            onClick={(event) => {
                if (event.button === 0 && !isDragging && !revealed && typeof onReveal === 'function') {
                    onReveal(id);
                }
            }}
            className={`tile ${isDragging ? 'dragging' : ''} ${revealed ? '' : 'facedown'}`}
        >
            {revealed ? letter : ''}
        </div>
    );
}
