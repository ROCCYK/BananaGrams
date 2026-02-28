import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

export function Tile({
    id,
    letter,
    left,
    top,
    revealed,
    isNew = false,
    onReveal,
    dragDisabled = false,
    inHand = false,
    selected = false,
    onSelect,
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: id,
        data: { id, letter },
        disabled: dragDisabled
    });

    const style = {
        position: inHand ? 'relative' : 'absolute',
        left: inHand ? undefined : `${left}px`,
        top: inHand ? undefined : `${top}px`,
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
                if (typeof onSelect === 'function') {
                    onSelect(id);
                }
                if (!dragDisabled && event.button === 0 && !isDragging && !revealed && typeof onReveal === 'function') {
                    onReveal(id);
                }
            }}
            className={`tile ${isDragging ? 'dragging' : ''} ${revealed ? '' : 'facedown'} ${isNew ? 'new-tile' : ''} ${inHand ? 'in-hand' : ''} ${selected ? 'selected' : ''}`}
        >
            {revealed ? letter : ''}
        </div>
    );
}
