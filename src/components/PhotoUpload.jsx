import React, { useState } from 'react';
import { useDialog } from './common/DialogProvider';

const PhotoUpload = ({ date, type, onUploadSuccess }) => {
    const { showAlert } = useDialog();
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState(null);
    const API_BASE_URL = 'http://localhost:8901';

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Preview
        const reader = new FileReader();
        reader.onloadend = () => setPreview(reader.result);
        reader.readAsDataURL(file);

        // Upload
        setUploading(true);
        const formData = new FormData();
        formData.append('image', file);
        formData.append('date', date);
        formData.append('type', type);

        try {
            const response = await fetch(`${API_BASE_URL}/api/upload`, {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            if (result.success) {
                onUploadSuccess(result.path);
            } else {
                showAlert?.("업로드 실패: " + result.error);
            }
        } catch (err) {
            showAlert?.("서버 연결 실패: " + err.message);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="photo-upload-container border-2 border-dashed border-slate-200 rounded-lg p-2 bg-slate-50 hover:bg-slate-100 transition-colors">
            <label className="flex flex-col items-center justify-center cursor-pointer min-h-[100px]">
                {preview ? (
                    <img src={preview} alt="preview" className="max-h-32 rounded object-cover" />
                ) : (
                    <div className="text-center">
                        <span className="material-icons text-slate-400 text-3xl">add_a_photo</span>
                        <p className="text-[10px] text-slate-500 mt-1 font-semibold">사진 첨부</p>
                    </div>
                )}
                <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} disabled={uploading} />
            </label>
            {uploading && <div className="text-[10px] text-corporate-blue text-center animate-pulse mt-1">보안 스캔 및 업로드 중...</div>}
        </div>
    );
};

export default PhotoUpload;
