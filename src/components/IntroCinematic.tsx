import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface IntroCinematicProps {
  onComplete: () => void;
}

const textBlocks = [
  "Kaito, el espadachín más veloz del imperio, no pudo proteger a su hija del Hálito del Abismo. Ahora, ella se desvanece en el Yomi.",
  "Desesperado, Kaito entregó su humanidad a una deidad antigua a cambio de una oportunidad.",
  "La deidad le advirtió:",
  "'Tu hija aún no cruza el Río de las Almas, pero en el inframundo el tiempo es tinta que se seca. Si te detienes, te conviertes en una mancha más en el papel.'"
];

export default function IntroCinematic({ onComplete }: IntroCinematicProps) {
  const [hasStarted, setHasStarted] = useState(false);
  const [isUnrolling, setIsUnrolling] = useState(true);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Sound effect for wind/brush
  useEffect(() => {
    if (!hasStarted) return;

    // Wait for unroll animation
    const unrollTimer = setTimeout(() => {
      setIsUnrolling(false);
    }, 2000);

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const audioCtx = new AudioContextClass();
        audioCtxRef.current = audioCtx;
        const bufferSize = audioCtx.sampleRate * 2;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.05;
        gainNodeRef.current = gainNode;

        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        noise.start();
      }
    } catch (e) {
      console.error("Audio context failed to start", e);
    }

    return () => {
      clearTimeout(unrollTimer);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, [hasStarted]);

  // Typing effect
  useEffect(() => {
    if (!hasStarted || isUnrolling) return;

    if (currentBlockIndex >= textBlocks.length) {
      setIsTyping(false);
      setShowPrompt(true);
      if (gainNodeRef.current) {
        // Fade out sound
        gainNodeRef.current.gain.setTargetAtTime(0, audioCtxRef.current?.currentTime || 0, 1);
      }
      return;
    }

    const fullText = textBlocks[currentBlockIndex];
    let charIndex = 0;
    setIsTyping(true);
    setDisplayedText('');

    const typeInterval = setInterval(() => {
      if (charIndex < fullText.length) {
        setDisplayedText(fullText.slice(0, charIndex + 1));
        charIndex++;
      } else {
        clearInterval(typeInterval);
        setIsTyping(false);
        // Wait a bit before moving to the next block, unless it's the last one
        if (currentBlockIndex < textBlocks.length - 1) {
          setTimeout(() => {
            setCurrentBlockIndex(prev => prev + 1);
          }, 1500); // Pause between paragraphs
        } else {
          setShowPrompt(true);
          if (gainNodeRef.current) {
            gainNodeRef.current.gain.setTargetAtTime(0, audioCtxRef.current?.currentTime || 0, 1);
          }
        }
      }
    }, 40); // Typing speed

    return () => clearInterval(typeInterval);
  }, [currentBlockIndex, hasStarted, isUnrolling]);

  // Handle Enter key or Click to skip or complete
  useEffect(() => {
    if (!hasStarted) {
      const handleStart = (e: KeyboardEvent | MouseEvent) => {
        setHasStarted(true);
      };
      window.addEventListener('keydown', handleStart);
      window.addEventListener('mousedown', handleStart);
      return () => {
        window.removeEventListener('keydown', handleStart);
        window.removeEventListener('mousedown', handleStart);
      };
    }

    const handleSkipOrComplete = () => {
      if (showPrompt) {
        onComplete();
      } else {
        // Skip typing
        setIsUnrolling(false);
        setCurrentBlockIndex(textBlocks.length);
        setDisplayedText(textBlocks[textBlocks.length - 1]);
        setIsTyping(false);
        setShowPrompt(true);
        if (gainNodeRef.current) {
          gainNodeRef.current.gain.setTargetAtTime(0, audioCtxRef.current?.currentTime || 0, 1);
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        handleSkipOrComplete();
      }
    };
    
    const handleMouseDown = (e: MouseEvent) => {
      handleSkipOrComplete();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [showPrompt, onComplete, hasStarted]);

  if (!hasStarted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950 cursor-pointer" onClick={() => setHasStarted(true)}>
        <p className="text-stone-500 tracking-widest uppercase animate-pulse font-serif">Haz clic para comenzar</p>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 1 } }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-stone-950 overflow-hidden"
    >
      {/* Scroll Background */}
      <motion.div 
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: '80vh', opacity: 1 }}
        transition={{ duration: isUnrolling ? 2 : 0, ease: "easeOut" }}
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100\' height=\'100\' filter=\'url(%23noise)\' opacity=\'0.15\'/%3E%3C/svg%3E")',
          boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5)'
        }}
        className="relative w-full max-w-3xl bg-[#d9c8a9] shadow-2xl overflow-hidden flex flex-col items-center p-8 md:p-16 border-y-8 border-stone-800"
      >
        {/* Scroll Rollers */}
        <div className="absolute top-0 left-0 w-full h-4 bg-stone-900 shadow-md"></div>
        <div className="absolute bottom-0 left-0 w-full h-4 bg-stone-900 shadow-md"></div>

        <div className="flex-1 w-full flex flex-col justify-center space-y-6 text-stone-900 font-serif text-lg md:text-2xl leading-relaxed text-center" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.1)' }}>
          {textBlocks.map((block, index) => {
            if (index < currentBlockIndex) {
              return <p key={index} className="opacity-90">{block}</p>;
            }
            if (index === currentBlockIndex) {
              return <p key={index} className="opacity-100">{displayedText}</p>;
            }
            return null;
          })}
        </div>

        <AnimatePresence>
          {showPrompt && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-8 text-stone-600 text-sm md:text-base tracking-widest uppercase animate-pulse"
            >
              Haz clic o presiona Enter para continuar
            </motion.div>
          )}
          {!showPrompt && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute bottom-4 right-4 text-stone-500/50 text-xs tracking-widest uppercase"
            >
              Haz clic para omitir
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
