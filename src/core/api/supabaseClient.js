/**
 * Supabase 클라이언트 싱글톤
 * 모든 Supabase 호출은 이 인스턴스를 공유합니다.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
