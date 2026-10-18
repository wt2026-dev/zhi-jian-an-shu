import { useState, useRef, useCallback, useEffect } from 'react';
import jsQR from 'jsqr';
import { Equipment } from '../../types';

interface UseInspectionQrScannerProps {
  equipments: Equipment[];
  isOpen: boolean;
  onMatched: (equip: Equipment) => void;
  onMismatch?: (rawCode: string) => void;
}

export function useInspectionQrScanner({
  equipments,
  isOpen,
  onMatched,
  onMismatch,
}: UseInspectionQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanAnimRef = useRef<number>(0);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const stopCamera = useCallback(() => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    if (scanAnimRef.current) {
      cancelAnimationFrame(scanAnimRef.current);
      scanAnimRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setScanning(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (scanAnimRef.current) cancelAnimationFrame(scanAnimRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Stop camera when modal is closed
  useEffect(() => {
    if (!isOpen && (cameraActive || scanning)) {
      stopCamera();
    }
  }, [isOpen, cameraActive, scanning, stopCamera]);

  const matchEquipmentByCode = useCallback(
    (code: string): Equipment | null => {
      let target = code.trim();
      try {
        if (target.includes('?') || target.startsWith('http://') || target.startsWith('https://')) {
          const urlObj = new URL(target, window.location.origin);
          const eqId =
            urlObj.searchParams.get('equipmentId') ||
            urlObj.searchParams.get('targetEquipmentId') ||
            urlObj.searchParams.get('id');
          if (eqId) target = eqId;
        }
      } catch {
        // Ignore non-URL strings
      }

      try {
        if (target.startsWith('{') && target.endsWith('}')) {
          const obj = JSON.parse(target);
          if (obj.code || obj.id) {
            const m = equipments.find(
              (e) =>
                e.code?.toUpperCase() === (obj.code || '').toUpperCase() ||
                e.id?.toUpperCase() === (obj.id || '').toUpperCase()
            );
            if (m) return m;
          }
        }
      } catch {
        // Ignore non-JSON strings
      }

      const normalized = target.toUpperCase();
      return (
        equipments.find(
          (eq) =>
            eq.code?.toUpperCase() === normalized ||
            eq.id?.toUpperCase() === normalized ||
            eq.name?.toUpperCase().includes(normalized)
        ) || null
      );
    },
    [equipments]
  );

  const handleScanResult = useCallback(
    (rawCode: string) => {
      stopCamera();
      const matched = matchEquipmentByCode(rawCode);
      if (matched) {
        onMatched(matched);
      } else {
        if (onMismatch) {
          onMismatch(rawCode);
        } else {
          setCameraError(`未识别到设备码，可手动选择下方设备（已扫码: ${rawCode}，未匹配系统设备）`);
        }
      }
    },
    [matchEquipmentByCode, onMatched, onMismatch, stopCamera]
  );

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);
    setScanning(true);

    scanTimeoutRef.current = setTimeout(() => {
      stopCamera();
      setCameraError('未识别到设备码，可手动选择下方设备');
    }, 20000);

    const scanFrame = () => {
      if (!videoRef.current || !canvasRef.current || !streamRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
        scanAnimRef.current = requestAnimationFrame(scanFrame);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });
      if (code && code.data) {
        handleScanResult(code.data);
        return;
      }
      scanAnimRef.current = requestAnimationFrame(scanFrame);
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        scanFrame();
      }
    } catch (err: unknown) {
      stopCamera();
      const errorObj = err as { name?: string; message?: string } | undefined;
      const msg =
        errorObj?.name === 'NotAllowedError'
          ? '未识别到设备码，可手动选择下方设备（摄像头权限被拒绝）'
          : errorObj?.name === 'NotFoundError'
          ? '未识别到设备码，可手动选择下方设备（未检测到可用摄像头）'
          : '未识别到设备码，可手动选择下方设备（' + (errorObj?.message || '未知错误') + '）';
      setCameraError(msg);
    }
  }, [handleScanResult, stopCamera]);

  return {
    videoRef,
    canvasRef,
    cameraActive,
    cameraError,
    scanning,
    setCameraError,
    startCamera,
    stopCamera,
    matchEquipmentByCode,
  };
}
