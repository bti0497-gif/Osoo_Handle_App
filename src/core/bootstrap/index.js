/**
 * 앱 기동 시 로컬 백엔드(Express) 연결·검증을 한곳에서 다룹니다.
 * 렌더러는 `initServerConfig` / `connectLocalBackend` 만 호출하면 됩니다.
 */
export { BootstrapMessage, AuthLoadingMessage } from './constants.js';
export { initServerConfig, connectLocalBackend, getApiBase, rediscoverServer } from '../api/serverConfig.js';
