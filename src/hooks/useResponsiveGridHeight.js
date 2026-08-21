import { useEffect, useState } from 'react';

const getResponsiveGridHeight = () => {
    if (typeof window === 'undefined') return 400;
    const viewportHeight = window.visualViewport?.height || window.innerHeight || 768;
    return Math.max(400, Math.round(viewportHeight * 0.52));
};

export const useResponsiveGridHeight = () => {
    const [height, setHeight] = useState(getResponsiveGridHeight);

    useEffect(() => {
        let frameId = null;
        const updateHeight = () => {
            if (frameId !== null) window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(() => {
                frameId = null;
                setHeight(getResponsiveGridHeight());
            });
        };

        window.addEventListener('resize', updateHeight);
        window.visualViewport?.addEventListener('resize', updateHeight);
        return () => {
            window.removeEventListener('resize', updateHeight);
            window.visualViewport?.removeEventListener('resize', updateHeight);
            if (frameId !== null) window.cancelAnimationFrame(frameId);
        };
    }, []);

    return height;
};
