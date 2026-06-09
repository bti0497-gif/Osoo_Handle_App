import React from 'react';
import CredentialCard from '../widgets/CredentialCard';

export default function WebAppPanel({
  webAppCredentials,
  passwordVisibility,
  urlEditability,
  updateWebAppCredentialField,
  togglePasswordVisibility,
  toggleUrlEditability,
  handleSaveWebAppCredentials,
  geminiApiKey,
  setGeminiApiKey,
  geminiKeyVisible,
  setGeminiKeyVisible,
  handleSaveGeminiApiKey,
  qntechImportSettings,
  handleSaveQntechImportSettings,
}) {
    // --- 일지 매핑용 DB 컬럼 옵션 구성 ---
    const renderWebAppSettings = () => (
        <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <CredentialCard
                sectionKey="roadWeb"
                title="도로공사 웹페이지 설정"
                description="도로공사 웹페이지 로그인 계정을 저장합니다."
                credential={webAppCredentials.roadWeb}
                isPasswordVisible={passwordVisibility.roadWeb}
                isUrlEditable={urlEditability.roadWeb}
                onFieldChange={updateWebAppCredentialField}
                onTogglePassword={togglePasswordVisibility}
                onToggleUrlEditable={toggleUrlEditability}
                onSave={handleSaveWebAppCredentials}
            />
            <CredentialCard
                sectionKey="waterAnalysisApp"
                title="수질분석 앱 설정"
                description="수질분석 앱 로그인 계정을 저장합니다."
                credential={webAppCredentials.waterAnalysisApp}
                isPasswordVisible={passwordVisibility.waterAnalysisApp}
                isUrlEditable={urlEditability.waterAnalysisApp}
                onFieldChange={updateWebAppCredentialField}
                onTogglePassword={togglePasswordVisibility}
                onToggleUrlEditable={toggleUrlEditability}
                onSave={handleSaveWebAppCredentials}
            />

            {/* Gemini API Key Section */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                backgroundColor: '#f8fafc',
                padding: '1.5rem',
                borderRadius: '14px',
                border: '1px solid #e2e8f0'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#1e293b' }}>Gemini API 설정</h3>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>AI 기능에 필요한 Gemini API 키를 등록합니다.</span>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>API Key</label>
                    <div style={{ position: 'relative' }}>
                        <input
                            type={geminiKeyVisible ? 'text' : 'password'}
                            value={geminiApiKey}
                            onChange={(e) => setGeminiApiKey(e.target.value)}
                            placeholder="AIza..."
                            style={{
                                width: '100%',
                                height: '42px',
                                border: '1.5px solid #cbd5e1',
                                borderRadius: '8px',
                                padding: '0 42px 0 12px',
                                fontSize: '0.8125rem',
                                fontWeight: 700,
                                fontFamily: 'monospace',
                                color: '#1e293b',
                                boxSizing: 'border-box',
                                backgroundColor: 'white'
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => setGeminiKeyVisible(prev => !prev)}
                            style={{
                                position: 'absolute',
                                top: '50%',
                                right: '10px',
                                transform: 'translateY(-50%)',
                                border: 'none',
                                background: 'none',
                                padding: 0,
                                width: '24px',
                                height: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                color: '#64748b'
                            }}
                            aria-label={geminiKeyVisible ? 'API 키 숨기기' : 'API 키 표시'}
                        >
                            <span className="material-icons" style={{ fontSize: '20px' }}>
                                {geminiKeyVisible ? 'visibility_off' : 'visibility'}
                            </span>
                        </button>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={handleSaveGeminiApiKey}
                        style={{
                            minWidth: '132px',
                            height: '42px',
                            border: 'none',
                            borderRadius: '10px',
                            backgroundColor: '#1e293b',
                            color: 'white',
                            fontSize: '0.8125rem',
                            fontWeight: 900,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: '18px' }}>save</span>
                        저장하기
                    </button>
                </div>
            </div>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                backgroundColor: '#f8fafc',
                padding: '1.5rem',
                borderRadius: '14px',
                border: '1px solid #e2e8f0'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#1e293b' }}>QnTECH 불러오기 설정</h3>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>수질분석 사진 저장 루트는 앱 내부 고정 경로를 사용합니다.</span>
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>사진 저장 루트</label>
                    <div
                        style={{
                            width: '100%',
                            height: '42px',
                            border: '1.5px solid #cbd5e1',
                            borderRadius: '8px',
                            padding: '0 12px',
                            fontSize: '0.8125rem',
                            fontWeight: 700,
                            color: '#1e293b',
                            boxSizing: 'border-box',
                            backgroundColor: '#f8fafc',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        {qntechImportSettings.photoRoot || '사진관리/수질분석'}
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                        저장 시 폴더가 없으면 자동으로 생성됩니다.
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={handleSaveQntechImportSettings}
                        style={{
                            minWidth: '160px',
                            height: '42px',
                            border: 'none',
                            borderRadius: '10px',
                            backgroundColor: '#1e293b',
                            color: 'white',
                            fontSize: '0.8125rem',
                            fontWeight: 900,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: '18px' }}>save</span>
                        불러오기 설정 저장
                    </button>
                </div>
            </div>
        </div>
    );


    return renderWebAppSettings();
}
