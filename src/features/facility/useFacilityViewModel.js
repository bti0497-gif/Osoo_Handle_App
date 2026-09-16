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
            recordId: id,
            title: `${result.date || ''} · ${result.title || '업무사진'}`,
            items: (result.photos || []).map((photo) => ({ ...photo, url: `${getApiBase()}${photo.url}` })),
            index: 0,
        });
    };

    const deletePhoto = async () => {
        const current = viewer?.items?.[viewer.index];
        if (!viewer?.recordId || !current?.id) return;
        await FacilityModel.deletePhoto(viewer.recordId, current.id);
        const result = await FacilityModel.fetchPhotos(viewer.recordId);
        const items = (result.photos || []).map((photo) => ({ ...photo, url: `${getApiBase()}${photo.url}` }));
        setViewer((previous) => previous ? {
            ...previous,
            items,
            index: Math.min(previous.index, Math.max(0, items.length - 1)),
        } : null);
        await loadLogs(searchQuery);
    };

    const addViewerPhotos = async (files) => {
        if (!viewer?.recordId || !files?.length) return;
        await FacilityModel.uploadPhotos(viewer.recordId, files);
        const result = await FacilityModel.fetchPhotos(viewer.recordId);
        const items = (result.photos || []).map((photo) => ({ ...photo, url: `${getApiBase()}${photo.url}` }));
        setViewer((previous) => previous ? { ...previous, items, index: Math.max(0, items.length - 1) } : null);
        await loadLogs(searchQuery);
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
        deletePhoto,
        addViewerPhotos,
    };
};
