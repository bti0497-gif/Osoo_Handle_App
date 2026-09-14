import { useState, useEffect, useCallback } from 'react';
import { FacilityModel } from './FacilityModel';
import { getApiBase } from '../../core/api/serverConfig.js';

export const useFacilityViewModel = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [viewer, setViewer] = useState(null);

    const loadLogs = useCallback(async (q = '') => {
        setLoading(true);
        try {
            const data = await FacilityModel.fetchAll(q || undefined);
            setLogs(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadLogs(); }, [loadLogs]);

    const handleSearch = (q) => {
        setSearchQuery(q);
        loadLogs(q);
    };

    const createLog = async (data) => {
        if (!data.title && !data.location && !data.content && !data.notes) return;
        const result = await FacilityModel.create(data);
        await loadLogs(searchQuery);
        return result;
    };

    const updateLog = async (id, data) => {
        await FacilityModel.update(id, data);
        await loadLogs(searchQuery);
    };

    const deleteLog = async (id) => {
        await FacilityModel.remove(id);
        await loadLogs(searchQuery);
    };

    const uploadPhotos = async (id, files) => {
        const result = await FacilityModel.uploadPhotos(id, files);
        await loadLogs(searchQuery);
        return result;
    };

    const openPhotoViewer = async (id) => {
        const result = await FacilityModel.fetchPhotos(id);
        setViewer({
            title: `${result.date || ''} · ${result.title || '업무사진'}`,
            items: (result.photos || []).map((photo) => ({ ...photo, url: `${getApiBase()}${photo.url}` })),
            index: 0,
        });
    };

    return {
        logs,
        loading,
        searchQuery,
        handleSearch,
        createLog,
        updateLog,
        deleteLog,
        uploadPhotos,
        openPhotoViewer,
        viewer,
        closePhotoViewer: () => setViewer(null),
        selectPhoto: (index) => setViewer((previous) => previous ? { ...previous, index } : null),
    };
};
