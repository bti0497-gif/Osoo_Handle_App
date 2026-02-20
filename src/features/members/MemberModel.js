import { supabase } from '../../core/api';

export const MemberModel = {
    async fetchMembers() {
        const { data, error } = await supabase
            .from('members')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw new Error(error.message);
        return data;
    },

    async saveMember(memberData) {
        if (memberData.id) {
            const { data, error } = await supabase
                .from('members')
                .update(memberData)
                .eq('id', memberData.id)
                .select()
                .single();
            if (error) throw new Error(error.message);
            return data;
        } else {
            const { id, ...insertData } = memberData;
            const { data, error } = await supabase
                .from('members')
                .insert([insertData])
                .select()
                .single();
            if (error) throw new Error(error.message);
            return data;
        }
    },

    async deleteMember(id) {
        const { error } = await supabase
            .from('members')
            .delete()
            .eq('id', id);

        if (error) throw new Error(error.message);
        return { success: true };
    }
};
