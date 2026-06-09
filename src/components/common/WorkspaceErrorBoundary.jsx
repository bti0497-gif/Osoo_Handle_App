import React from 'react';

class WorkspaceErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('[WorkspaceErrorBoundary]', error, info);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
            this.setState({ error: null });
        }
    }

    render() {
        if (!this.state.error) {
            return this.props.children;
        }

        return (
            <div className="workspace-error-state">
                <div className="workspace-error-state__card">
                    <span className="material-icons">warning_amber</span>
                    <h2>화면을 불러오지 못했습니다.</h2>
                    <p>
                        앱의 기본 화면은 유지됩니다. 다른 메뉴로 이동하거나 새로고침을 눌러 다시 시도해 주세요.
                    </p>
                    <button type="button" onClick={() => this.setState({ error: null })}>
                        새로고침
                    </button>
                </div>
            </div>
        );
    }
}

export default WorkspaceErrorBoundary;
