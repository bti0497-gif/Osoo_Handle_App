import { useState, useEffect, useCallback } from 'react';
import { FacilityModel } from './FacilityModel';

export const useFacilityViewModel = (currentUser, { showAlert } = {}) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

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
        if (!data.facility_name && !data.location && !data.content) return;
        await FacilityModel.create(data);
        await loadLogs(searchQuery);
    };

    const updateLog = async (id, data) => {
        await FacilityModel.update(id, data);
        await loadLogs(searchQuery);
    };

    const deleteLog = async (id) => {
        await FacilityModel.remove(id);
        await loadLogs(searchQuery);
    };

    return { logs, loading, searchQuery, handleSearch, createLog, updateLog, deleteLog };
};
