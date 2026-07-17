import React from 'react';
import ItemManagementPanel from './ItemManagementPanel';
import LocationOrderEditor from '../widgets/LocationOrderEditor';

export default function MeasurementPlacePanel({
    items,
    isSiteSelected,
    value,
    onValueChange,
    onToggle,
    onMove,
    addItem,
    onOpenKitDefaultModal,
}) {
    return (
        <ItemManagementPanel
            title="분석장소 위젯"
            items={items}
            type="location"
            value={value}
            onValueChange={onValueChange}
            placeholder="분석 장소 추가..."
            addTitle="분석 장소 추가"
            renderItemGrid={(gridItems) => (
                <LocationOrderEditor
                    items={gridItems}
                    isSiteSelected={isSiteSelected}
                    onToggle={onToggle}
                    onMove={onMove}
                />
            )}
            addItem={addItem}
            actionLabel="키트량지정"
            onAction={onOpenKitDefaultModal}
        />
    );
}
