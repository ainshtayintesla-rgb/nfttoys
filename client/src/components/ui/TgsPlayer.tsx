"use client";

import React, { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import pako from "pako";
import { useAnimations } from "@/lib/context/AnimationContext";

interface TgsPlayerProps {
    src: string;
    className?: string;
    style?: React.CSSProperties;
    unstyled?: boolean;
    cacheKey?: string;
    loop?: boolean;
    autoplay?: boolean;
    playOnHover?: boolean;
    renderer?: "svg" | "canvas";
}

const animationDataCache = new Map<string, object>();
const animationDataRequests = new Map<string, Promise<object>>();
let lottieQualityConfigured = false;

const getDeviceQuality = (): "low" | "medium" => {
    if (typeof navigator === "undefined") {
        return "medium";
    }

    const nav = navigator as Navigator & { deviceMemory?: number };
    const cpuCores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : 8;
    const memoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : 8;

    return cpuCores <= 4 || memoryGb <= 4 ? "low" : "medium";
};

const ensureLottieQuality = () => {
    if (lottieQualityConfigured || typeof window === "undefined") {
        return;
    }

    lottie.setQuality(getDeviceQuality());
    lottieQualityConfigured = true;
};

const loadTgsData = async (src: string, storageKey: string): Promise<object> => {
    const cachedData = animationDataCache.get(storageKey);
    if (cachedData) {
        return cachedData;
    }

    const pending = animationDataRequests.get(storageKey);
    if (pending) {
        return pending;
    }

    const request = (async () => {
        if (typeof window !== "undefined") {
            const cachedJson = window.sessionStorage.getItem(storageKey);
            if (cachedJson) {
                const parsed = JSON.parse(cachedJson) as object;
                animationDataCache.set(storageKey, parsed);
                return parsed;
            }
        }

        const response = await fetch(src);
        const compressed = await response.arrayBuffer();
        const json = pako.inflate(new Uint8Array(compressed), { to: "string" });
        const parsed = JSON.parse(json) as object;

        animationDataCache.set(storageKey, parsed);

        if (typeof window !== "undefined") {
            try {
                window.sessionStorage.setItem(storageKey, json);
            } catch {
                console.warn("TGS cache quota exceeded, skipping cache write");
            }
        }

        return parsed;
    })();

    animationDataRequests.set(storageKey, request);

    try {
        return await request;
    } finally {
        animationDataRequests.delete(storageKey);
    }
};

export const TgsPlayer = React.memo(
    ({
        src,
        className,
        style,
        unstyled = false,
        cacheKey,
        loop = false,
        autoplay = true,
        playOnHover = false,
        renderer = "canvas",
    }: TgsPlayerProps) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const animationRef = useRef<AnimationItem | null>(null);
        const isVisibleRef = useRef(false);
        const shouldLoadRef = useRef(false);
        const autoplayRef = useRef(autoplay);
        const animationsEnabledRef = useRef(true);

        const [shouldLoad, setShouldLoad] = useState(false);
        const [animationData, setAnimationData] = useState<object | null>(null);

        const { animationsEnabled } = useAnimations();

        const baseClass = unstyled
            ? "group flex items-center justify-center"
            : "group flex h-10 w-10 items-center justify-center rounded-full bg-neutral-200/80 p-2 text-2xl text-neutral-500 transition-all duration-300 hover:bg-neutral-300/50 dark:bg-neutral-800/80 dark:hover:bg-neutral-800/50";
        const wrapperClassName = className ? `${baseClass} ${className}` : baseClass;

        useEffect(() => {
            autoplayRef.current = autoplay;

            const animation = animationRef.current;
            if (!animation || !animationsEnabledRef.current) {
                return;
            }

            if (isVisibleRef.current && autoplayRef.current) {
                animation.play();
            } else {
                animation.pause();
            }
        }, [autoplay]);

        useEffect(() => {
            animationsEnabledRef.current = animationsEnabled;

            const animation = animationRef.current;
            if (!animation) {
                return;
            }

            if (!animationsEnabled) {
                animation.goToAndStop(0, true);
                return;
            }

            if (isVisibleRef.current && autoplayRef.current) {
                animation.play();
            } else {
                animation.pause();
            }
        }, [animationsEnabled]);

        useEffect(() => {
            const shouldLoadNow = isVisibleRef.current;
            shouldLoadRef.current = shouldLoadNow;
            setShouldLoad(shouldLoadNow);
            setAnimationData(null);
        }, [src, cacheKey]);

        useEffect(() => {
            const target = containerRef.current;
            if (!target) {
                return;
            }

            if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
                isVisibleRef.current = true;
                shouldLoadRef.current = true;
                queueMicrotask(() => setShouldLoad(true));
                return;
            }

            const observer = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        const isVisible = entry.isIntersecting;
                        isVisibleRef.current = isVisible;

                        if (isVisible && !shouldLoadRef.current) {
                            shouldLoadRef.current = true;
                            setShouldLoad(true);
                        }

                        const animation = animationRef.current;
                        if (!animation) {
                            return;
                        }

                        if (!animationsEnabledRef.current) {
                            animation.goToAndStop(0, true);
                            return;
                        }

                        if (isVisible && autoplayRef.current) {
                            animation.play();
                        } else {
                            animation.pause();
                        }
                    });
                },
                {
                    threshold: 0.15,
                    rootMargin: "200px 0px 200px 0px",
                }
            );

            observer.observe(target);

            return () => {
                observer.disconnect();
            };
        }, []);

        useEffect(() => {
            if (!shouldLoad || animationData) {
                return;
            }

            let canceled = false;
            const storageKey = cacheKey || `tgs-cache:${src}`;

            loadTgsData(src, storageKey)
                .then((data) => {
                    if (!canceled) {
                        setAnimationData(data);
                    }
                })
                .catch((err) => {
                    if (!canceled) {
                        console.error("TGS parse error:", err);
                    }
                });

            return () => {
                canceled = true;
            };
        }, [shouldLoad, animationData, src, cacheKey]);

        useEffect(() => {
            if (!animationData || !containerRef.current) {
                return;
            }

            ensureLottieQuality();

            const rendererSettings = renderer === "svg"
                ? {
                    preserveAspectRatio: "xMidYMid meet",
                    progressiveLoad: true,
                    hideOnTransparent: true,
                }
                : {
                    preserveAspectRatio: "xMidYMid meet",
                    clearCanvas: true,
                };

            const animation = lottie.loadAnimation({
                container: containerRef.current,
                renderer,
                loop,
                autoplay: false,
                animationData,
                rendererSettings: rendererSettings as never,
            });

            animationRef.current = animation;
            animation.setSubframe(false);

            if (!animationsEnabledRef.current) {
                animation.goToAndStop(0, true);
            } else if (isVisibleRef.current && autoplayRef.current) {
                animation.play();
            } else {
                animation.pause();
            }

            const resizeObserver = typeof window !== "undefined" && "ResizeObserver" in window
                ? new ResizeObserver(() => animation.resize())
                : null;

            if (resizeObserver && containerRef.current) {
                resizeObserver.observe(containerRef.current);
            }

            return () => {
                resizeObserver?.disconnect();
                animation.destroy();

                if (animationRef.current === animation) {
                    animationRef.current = null;
                }
            };
        }, [animationData, loop, renderer]);

        const handleMouseEnter = () => {
            if (!playOnHover || !animationsEnabled) {
                return;
            }

            if (!shouldLoadRef.current) {
                shouldLoadRef.current = true;
                setShouldLoad(true);
                return;
            }

            animationRef.current?.goToAndPlay(0, true);
        };

        return (
            <div className={wrapperClassName} onMouseEnter={handleMouseEnter}>
                <div
                    ref={containerRef}
                    style={style}
                    className={`flex h-full w-full items-center justify-center${animationData ? "" : " animate-pulse"}`}
                />
            </div>
        );
    }
);

TgsPlayer.displayName = "TgsPlayer";
