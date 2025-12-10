// React Hook for Voice Chat in Watch Room
'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { WatchRoomSocket } from '@/lib/watch-room-socket';
import type { Member } from '@/types/watch-room';

interface UseVoiceChatOptions {
  socket: WatchRoomSocket | null;
  roomId: string | null;
  isMicEnabled: boolean;
  isSpeakerEnabled: boolean;
  members: Member[];
}

// 语音聊天策略类型
type VoiceStrategy = 'webrtc-fallback' | 'server-only';

// 获取语音聊天策略配置
function getVoiceStrategy(): VoiceStrategy {
  if (typeof window === 'undefined') return 'webrtc-fallback';
  const strategy = process.env.NEXT_PUBLIC_VOICE_CHAT_STRATEGY || 'webrtc-fallback';
  return strategy as VoiceStrategy;
}

export function useVoiceChat({
  socket,
  roomId,
  isMicEnabled,
  isSpeakerEnabled,
  members,
}: UseVoiceChatOptions) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategy] = useState<VoiceStrategy>(getVoiceStrategy());

  // WebRTC 相关
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const nextPlayTimeRef = useRef<Map<string, number>>(new Map()); // 跟踪每个用户的下一个播放时间

  // 服务器中转相关
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // 使用ref存储回退函数，避免循环依赖
  const switchToServerRelayRef = useRef<(() => void) | null>(null);
  const playRemoteStreamRef = useRef<((peerId: string, stream: MediaStream) => void) | null>(null);

  // ICE服务器配置（使用免费的STUN服务器）
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // 获取本地麦克风流
  const getLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;
      console.log('[VoiceChat] Got local stream');
      return stream;
    } catch (err) {
      console.error('[VoiceChat] Failed to get local stream:', err);
      setError('无法访问麦克风，请检查权限设置');
      throw err;
    }
  }, []);

  // 停止本地流
  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      console.log('[VoiceChat] Stopped local stream');
    }
  }, []);

  // ==================== WebRTC P2P 逻辑 ====================

  // 创建 RTCPeerConnection
  const createPeerConnection = useCallback((peerId: string) => {
    const pc = new RTCPeerConnection({ iceServers });

    // ICE候选收集
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('voice:ice', {
          targetUserId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // 接收远程音频流
    pc.ontrack = (event) => {
      console.log('[VoiceChat] Received remote track from', peerId);
      const remoteStream = event.streams[0];
      remoteStreamsRef.current.set(peerId, remoteStream);

      // 创建音频元素播放远程流
      if (isSpeakerEnabled) {
        playRemoteStreamRef.current?.(peerId, remoteStream);
      }
    };

    // 连接状态变化
    pc.onconnectionstatechange = () => {
      console.log('[VoiceChat] Connection state with', peerId, ':', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setIsConnected(true);
        setIsConnecting(false);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // WebRTC连接失败，如果策略允许，切换到服务器中转
        if (strategy === 'webrtc-fallback') {
          console.log('[VoiceChat] WebRTC failed, falling back to server relay');
          switchToServerRelayRef.current?.();
        }
      }
    };

    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  }, [socket, isSpeakerEnabled, strategy]);

  // 播放远程音频流
  const playRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    let audio = remoteAudioElementsRef.current.get(peerId);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      remoteAudioElementsRef.current.set(peerId, audio);
    }
    audio.srcObject = stream;
  }, []);

  // 将播放函数存储到ref中，供createPeerConnection使用
  useEffect(() => {
    playRemoteStreamRef.current = playRemoteStream;
  }, [playRemoteStream]);

  // 停止播放远程音频流
  const stopRemoteStream = useCallback((peerId: string) => {
    const audio = remoteAudioElementsRef.current.get(peerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      remoteAudioElementsRef.current.delete(peerId);
    }
    remoteStreamsRef.current.delete(peerId);

    // 清除该用户的播放时间记录
    nextPlayTimeRef.current.delete(peerId);
  }, []);

  // 清理WebRTC连接
  const cleanupWebRTC = useCallback(() => {
    // 关闭所有peer connections
    peerConnectionsRef.current.forEach((pc, peerId) => {
      pc.close();
      stopRemoteStream(peerId);
    });
    peerConnectionsRef.current.clear();

    console.log('[VoiceChat] WebRTC cleaned up');
  }, [stopRemoteStream]);

  // 向对等端发起连接（创建offer）
  const initiateConnection = useCallback(async (peerId: string) => {
    if (!socket || !localStreamRef.current) return;

    console.log('[VoiceChat] Initiating connection to', peerId);
    const pc = createPeerConnection(peerId);

    // 添加本地流
    localStreamRef.current.getTracks().forEach(track => {
      if (localStreamRef.current) {
        pc.addTrack(track, localStreamRef.current);
      }
    });

    // 创建offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('voice:offer', {
        targetUserId: peerId,
        offer: offer,
      });
      console.log('[VoiceChat] Sent offer to', peerId);
    } catch (err) {
      console.error('[VoiceChat] Failed to create offer:', err);
    }
  }, [socket, createPeerConnection]);

  // 处理接收到的offer
  const handleOffer = useCallback(async (data: { userId: string; offer: RTCSessionDescriptionInit }) => {
    if (!socket) return;

    console.log('[VoiceChat] Received offer from', data.userId);
    const pc = createPeerConnection(data.userId);

    // 如果有本地流，添加音频轨道
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        if (localStreamRef.current) {
          pc.addTrack(track, localStreamRef.current);
          console.log('[VoiceChat] Added local track to answer');
        }
      });
    } else {
      console.log('[VoiceChat] No local stream, creating answer without sending audio');
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('voice:answer', {
        targetUserId: data.userId,
        answer: answer,
      });
      console.log('[VoiceChat] Sent answer to', data.userId);
    } catch (err) {
      console.error('[VoiceChat] Failed to handle offer:', err);
    }
  }, [socket, createPeerConnection]);

  // 处理接收到的answer
  const handleAnswer = useCallback(async (data: { userId: string; answer: RTCSessionDescriptionInit }) => {
    console.log('[VoiceChat] Received answer from', data.userId);
    const pc = peerConnectionsRef.current.get(data.userId);
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (err) {
      console.error('[VoiceChat] Failed to handle answer:', err);
    }
  }, []);

  // 处理接收到的ICE候选
  const handleIceCandidate = useCallback(async (data: { userId: string; candidate: RTCIceCandidateInit }) => {
    const pc = peerConnectionsRef.current.get(data.userId);
    if (!pc) return;

    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.error('[VoiceChat] Failed to add ICE candidate:', err);
    }
  }, []);

  // ==================== 服务器中转逻辑 ====================

  // 启动服务器中转
  const startServerRelay = useCallback(() => {
    if (!socket || !localStreamRef.current) {
      console.error('[VoiceChat] Cannot start server relay - missing socket or stream');
      return;
    }

    if (!roomId) {
      console.error('[VoiceChat] Cannot start server relay - missing roomId');
      return;
    }

    console.log('[VoiceChat] Starting server relay');

    try {
      // 创建AudioContext来处理音频
      const audioContext = new AudioContext({ sampleRate: 16000 }); // 降低采样率以减少数据量
      const source = audioContext.createMediaStreamSource(localStreamRef.current);

      // 使用ScriptProcessorNode处理音频数据
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      // 保存roomId的引用，避免闭包问题
      const currentRoomId = roomId;

      processor.onaudioprocess = (e) => {
        if (!socket || !socket.connected) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);

        // 计算音频能量，判断是否为有效数据
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);

        // 如果音频能量低于阈值（静音或无效数据），则不发送
        // RMS阈值设为0.01，可以过滤掉大部分静音和无效数据
        const SILENCE_THRESHOLD = 0.01;
        if (rms < SILENCE_THRESHOLD) {
          return;
        }

        // 将Float32Array转换为Int16Array（PCM格式）以减少数据量
        const pcmData = new Int16Array(inputData.length);
        let zeroCount = 0;
        for (let i = 0; i < inputData.length; i++) {
          // 将-1到1的浮点数转换为-32768到32767的整数
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;

          // 统计接近0的样本数量（阈值为256，约为1%的最大值）
          if (Math.abs(pcmData[i]) < 256) {
            zeroCount++;
          }
        }

        // 如果超过95%的数据接近0，则认为是无效数据包，不发送
        const zeroRatio = zeroCount / pcmData.length;
        if (zeroRatio > 0.95) {
          return;
        }

        // 发送PCM数据到服务器
        socket.emit('voice:audio-chunk', {
          roomId: currentRoomId,
          audioData: Array.from(new Uint8Array(pcmData.buffer)),
          sampleRate: 16000,
        });
      };

      source.connect(processor);

      // ScriptProcessorNode需要连接到某个节点才能触发onaudioprocess
      // 但连接到destination会产生本地回声，所以创建一个静音的GainNode
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0; // 静音，不输出到喇叭
      processor.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // 保存引用以便清理
      audioContextRef.current = audioContext;
      mediaRecorderRef.current = processor as any; // 存储processor用于清理

      console.log('[VoiceChat] Server relay started');
    } catch (err) {
      console.error('[VoiceChat] Failed to start server relay:', err);
      setError('服务器中转启动失败');
    }
  }, [socket, roomId]);

  // 停止服务器中转
  const stopServerRelay = useCallback(() => {
    if (mediaRecorderRef.current) {
      // ScriptProcessorNode没有stop方法，需要断开连接
      const processor = mediaRecorderRef.current as any;
      if (processor.disconnect) {
        processor.disconnect();
      }
      mediaRecorderRef.current = null;
      console.log('[VoiceChat] Server relay stopped');
    }
  }, []);

  // 切换到服务器中转模式
  const switchToServerRelay = useCallback(async () => {
    console.log('[VoiceChat] Switching to server relay mode');
    setError('P2P连接失败，切换到服务器中转模式');

    // 清理WebRTC连接
    cleanupWebRTC();

    // 启动服务器中转
    if (isMicEnabled && localStreamRef.current) {
      startServerRelay();
    }
  }, [isMicEnabled, cleanupWebRTC, startServerRelay]);

  // 将回退函数存储到ref中，供createPeerConnection使用
  useEffect(() => {
    switchToServerRelayRef.current = switchToServerRelay;
  }, [switchToServerRelay]);

  // 播放服务器中转的音频 - 使用Web Audio API播放PCM数据
  const playServerRelayAudio = useCallback(async (userId: string, audioData: number[], sampleRate: number = 16000) => {
    if (!isSpeakerEnabled) return;

    try {
      // 创建AudioContext（如果不存在）
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const audioContext = audioContextRef.current;

      // 将Uint8Array转换回Int16Array (PCM数据)
      const uint8Array = new Uint8Array(audioData);
      const int16Array = new Int16Array(uint8Array.buffer);

      // 将Int16Array转换为Float32Array（AudioBuffer需要的格式）
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        // 将-32768到32767的整数转换回-1到1的浮点数
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
      }

      // 创建AudioBuffer
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Array);

      // 计算音频块的持续时间
      const duration = float32Array.length / sampleRate;

      // 获取当前时间和下一个播放时间
      const currentTime = audioContext.currentTime;
      let nextPlayTime = nextPlayTimeRef.current.get(userId) || currentTime;

      // 如果下一个播放时间已经过去，使用当前时间
      if (nextPlayTime < currentTime) {
        nextPlayTime = currentTime;
      }

      // 创建AudioBufferSourceNode并调度播放
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(nextPlayTime);

      // 更新下一个播放时间
      nextPlayTimeRef.current.set(userId, nextPlayTime + duration);
    } catch (err) {
      console.error('[VoiceChat] Failed to play audio:', err);
      setError('音频播放失败: ' + (err as Error).message);
    }
  }, [isSpeakerEnabled]);

  // ==================== 清理函数 ====================

  // 清理所有连接
  const cleanup = useCallback(() => {
    stopLocalStream();
    cleanupWebRTC();
    stopServerRelay();

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // 清除播放时间记录
    nextPlayTimeRef.current.clear();

    setIsConnected(false);
    setIsConnecting(false);
    setError(null);

    console.log('[VoiceChat] All cleaned up');
  }, [stopLocalStream, cleanupWebRTC, stopServerRelay]);

  // ==================== 主要控制逻辑 ====================

  // 监听麦克风状态变化
  useEffect(() => {
    if (!socket || !roomId) return;

    if (isMicEnabled) {
      // 开启麦克风
      setIsConnecting(true);
      setError(null);

      getLocalStream()
        .then(() => {
          console.log('[VoiceChat] Local stream ready');

          if (strategy === 'server-only') {
            // 仅使用服务器中转
            startServerRelay();
          } else {
            // 使用WebRTC P2P连接
            console.log('[VoiceChat] WebRTC mode - initiating peer connections');

            // 向房间内的其他成员发起连接
            const otherMembers = members.filter(m => m.id !== socket.id);
            console.log('[VoiceChat] Found', otherMembers.length, 'other members, initiating connections');

            if (otherMembers.length > 0) {
              otherMembers.forEach(member => {
                console.log('[VoiceChat] Initiating connection to', member.name, member.id);
                initiateConnection(member.id);
              });
            } else {
              // 如果没有其他成员，先启动服务器中转作为后备
              console.log('[VoiceChat] No other members, using server relay as fallback');
              startServerRelay();
            }
          }

          setIsConnecting(false);
        })
        .catch(() => {
          setIsConnecting(false);
        });
    } else {
      // 关闭麦克风
      stopLocalStream();
      cleanupWebRTC();
      stopServerRelay();
    }

    return () => {
      if (!isMicEnabled) {
        cleanup();
      }
    };
  }, [isMicEnabled, socket, roomId, strategy, members, getLocalStream, stopLocalStream, cleanupWebRTC, stopServerRelay, startServerRelay, cleanup, initiateConnection]);

  // 监听喇叭状态变化
  useEffect(() => {
    if (isSpeakerEnabled) {
      // 开启喇叭 - 播放所有远程流
      remoteStreamsRef.current.forEach((stream, peerId) => {
        playRemoteStream(peerId, stream);
      });
    } else {
      // 关闭喇叭 - 静音所有远程流
      remoteAudioElementsRef.current.forEach(audio => {
        audio.muted = true;
      });
    }

    // 恢复音量
    return () => {
      if (isSpeakerEnabled) {
        remoteAudioElementsRef.current.forEach(audio => {
          audio.muted = false;
        });
      }
    };
  }, [isSpeakerEnabled, playRemoteStream]);

  // 监听Socket.IO事件
  useEffect(() => {
    if (!socket) return;

    // WebRTC信令事件
    socket.on('voice:offer', handleOffer);
    socket.on('voice:answer', handleAnswer);
    socket.on('voice:ice', handleIceCandidate);

    // 监听其他用户开启麦克风的通知
    socket.on('voice:mic-enabled', (data: { userId: string }) => {
      console.log('[VoiceChat] User', data.userId, 'enabled microphone');
      // 其他用户开启了麦克风，我们不需要做任何事，等待接收他们的offer即可
    });

    // 服务器中转事件
    const handleAudioChunk = (data: { userId: string; audioData: number[]; sampleRate?: number }) => {
      if (strategy === 'server-only' || !peerConnectionsRef.current.has(data.userId)) {
        // 只有在服务器中转模式或WebRTC连接失败时才播放服务器中转的音频
        playServerRelayAudio(data.userId, data.audioData, data.sampleRate || 16000);
      }
    };

    socket.on('voice:audio-chunk', handleAudioChunk);

    return () => {
      socket.off('voice:offer', handleOffer);
      socket.off('voice:answer', handleAnswer);
      socket.off('voice:ice', handleIceCandidate);
      socket.off('voice:mic-enabled');
      socket.off('voice:audio-chunk', handleAudioChunk);
    };
  }, [socket, strategy, handleOffer, handleAnswer, handleIceCandidate, playServerRelayAudio]);

  // 监听房间成员变化 - 处理新成员加入的情况
  useEffect(() => {
    // 只在WebRTC模式、麦克风开启、有本地流的情况下才处理
    if (strategy !== 'webrtc-fallback' || !isMicEnabled || !localStreamRef.current || !socket) {
      return;
    }

    // 检查是否有新成员加入
    const currentPeerIds = Array.from(peerConnectionsRef.current.keys());
    const memberIds = members.filter(m => m.id !== socket.id).map(m => m.id);

    // 找出新加入的成员（在memberIds中但不在currentPeerIds中）
    const newMemberIds = memberIds.filter(id => !currentPeerIds.includes(id));

    if (newMemberIds.length > 0) {
      console.log('[VoiceChat] New members joined, initiating connections:', newMemberIds);
      newMemberIds.forEach(memberId => {
        const member = members.find(m => m.id === memberId);
        if (member) {
          console.log('[VoiceChat] Initiating connection to new member:', member.name, member.id);
          initiateConnection(member.id);
        }
      });
    }
  }, [members, strategy, isMicEnabled, socket, initiateConnection]);

  // 房间变化时清理
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [roomId, cleanup]);

  return {
    isConnecting,
    isConnected,
    error,
    strategy,
    initiateConnection, // 暴露给外部使用，用于向新加入的成员发起连接
  };
}
