import { supabase } from '../../core/api';

export const AttendanceModel = {
    async fetchAttendance(date) {
        const { data, error } = await supabase
            .from('attendance')
            .select('*')
            .eq('date', date)
            .order('login_time', { ascending: false });

        if (error) throw new Error('Failed to fetch attendance logs: ' + error.message);

        return data.map(log => ({
            ...log,
            member_name: log.member_name || log.name,
            is_remote: !log.location_matched
        }));
    }
};
