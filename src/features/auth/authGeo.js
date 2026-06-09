import { apiClient } from '../../core/api';

/** 위치 API는 PowerShell 등으로 최대 ~20초까지 걸릴 수 있어 여유를 둡니다. */
const LOCATION_REQUEST_MS = 28000;

export async function getCurrentCoords() {
    try {
        const data = await apiClient.get('/api/location/current', {}, { timeout: LOCATION_REQUEST_MS });
        if (data.success) {
            return { latitude: data.latitude, longitude: data.longitude };
        }
        return null;
    } catch {
        return null;
    }
}

export function checkLocationMatched(userData, currentCoords) {
    if (!userData.target_lat || !userData.target_lng || !currentCoords) return false;
    const R = 6371e3;
    const φ1 = (currentCoords.latitude * Math.PI) / 180;
    const φ2 = (userData.target_lat * Math.PI) / 180;
    const Δφ = ((userData.target_lat - currentCoords.latitude) * Math.PI) / 180;
    const Δλ = ((userData.target_lng - currentCoords.longitude) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return dist <= (userData.radius_m || 500);
}
