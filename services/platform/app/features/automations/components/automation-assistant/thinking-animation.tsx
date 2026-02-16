'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface ThinkingAnimationProps {
  steps: string[];
}

export function ThinkingAnimation({ steps }: ThinkingAnimationProps) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (currentStep < steps.length - 1) {
      interval = setInterval(() => {
        setCurrentStep((prev) => prev + 1);
      }, 2500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentStep, steps.length]);

  return (
    <div className="flex justify-start">
      <motion.div
        key={currentStep}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{
          duration: 0.3,
          ease: [0.25, 0.1, 0.25, 1],
        }}
        className="text-muted-foreground flex items-center gap-2 px-3 text-xs"
      >
        <motion.span
          key={currentStep}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.25,
            ease: [0.25, 0.1, 0.25, 1],
          }}
          className="inline-block"
        >
          {steps[currentStep]}
        </motion.span>
        <div className="flex space-x-1">
          <div className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full" />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      </motion.div>
    </div>
  );
}
