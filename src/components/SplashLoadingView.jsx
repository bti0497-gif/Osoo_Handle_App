import React from 'react';
import './SplashLoadingView.css';

const SplashLoadingView = ({ percent = 0, label = '데이터 로딩 중...', showProgress = true }) => {
    const radius = 64;
    const strokeWidth = 4;
    const normalizedRadius = radius - strokeWidth * 2;
    const circumference = normalizedRadius * 2 * Math.PI;
    const strokeDashoffset = circumference - (percent / 100) * circumference;

    return (
        <div className="splash-loading-container">
            <div className="splash-scene-wrapper">
                {/* 원형 진행 링 */}
                <svg className="splash-progress-ring" width={radius * 2} height={radius * 2}>
                    <circle
                        className="splash-progress-ring-bg"
                        stroke="rgba(255, 255, 255, 0.05)"
                        fill="transparent"
                        strokeWidth={strokeWidth}
                        r={normalizedRadius}
                        cx={radius}
                        cy={radius}
                    />
                    <circle
                        className="splash-progress-ring-bar"
                        stroke="url(#splash-grad)"
                        fill="transparent"
                        strokeWidth={strokeWidth}
                        strokeDasharray={circumference + ' ' + circumference}
                        style={{ strokeDashoffset }}
                        strokeLinecap="round"
                        r={normalizedRadius}
                        cx={radius}
                        cy={radius}
                    />
                    <defs>
                        <linearGradient id="splash-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#2563eb" />
                            <stop offset="50%" stopColor="#3b82f6" />
                            <stop offset="100%" stopColor="#60a5fa" />
                        </linearGradient>
                    </defs>
                </svg>

                {/* 중앙 물결 및 로고 배 */}
                <div className="splash-boat-viewport">
                    {/* 네온 배경 아우라 */}
                    <div className="splash-aura-glow" />

                    {/* 물결 위 배처럼 헤쳐나가는 로고 */}
                    <div className="splash-logo-boat">
                        <img src="./logo.png" alt="Company Logo" className="splash-boat-img" />
                        <div className="splash-boat-shadow" />
                    </div>

                    {/* 넘실거리는 다중 레이어 SVG 파도 */}
                    <div className="splash-wave-area">
                        <svg className="splash-waves" xmlns="http://www.w3.org/2000/svg" viewBox="0 24 150 28" preserveAspectRatio="none" shapeRendering="auto">
                            <defs>
                                <path id="gentle-wave" d="M-160 44c30 0 58-18 88-18s58 18 88 18 58-18 88-18 58 18 88 18v44h-352z" />
                            </defs>
                            <g className="splash-wave-parallax">
                                <use href="#gentle-wave" x="48" y="0" className="wave-layer wave-layer1" />
                                <use href="#gentle-wave" x="48" y="3" className="wave-layer wave-layer2" />
                                <use href="#gentle-wave" x="48" y="5" className="wave-layer wave-layer3" />
                                <use href="#gentle-wave" x="48" y="7" className="wave-layer wave-layer4" />
                            </g>
                        </svg>
                    </div>
                </div>
            </div>

            {/* 로딩 텍스트 정보 */}
            <div className="splash-text-section">
                <h2 className="splash-title">더죤환경기술(주)</h2>
                {label ? <p className="splash-label">{label}</p> : null}
                {showProgress ? (
                    <div className="splash-progress-info">
                        <span className="splash-percent-num">{percent}</span>
                        <span className="splash-percent-sign">%</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default SplashLoadingView;
