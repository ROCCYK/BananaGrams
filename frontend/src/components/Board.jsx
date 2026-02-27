import { useDroppable } from '@dnd-kit/core';

export function Board({ children }) {
    const { isOver, setNodeRef } = useDroppable({
        id: 'board-droppable',
    });

    const style = {
        flex: 1,
        position: 'relative',
        opacity: isOver ? 0.9 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} className="board-container">
            {children}
        </div>
    );
}
