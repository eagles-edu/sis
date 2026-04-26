<template>
    <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
            <radialGradient id="lights_gradient0">
                <stop offset="50%">
                    <animate attributeName="offset" dur="2s" repeatCount="indefinite" values="0.2; 0.7; 0.2" />
                </stop>
                <stop offset="50%" stop-color="var(--color0, #fff)">
                    <animate attributeName="offset" dur="2s" repeatCount="indefinite" values="0.2; 0.7; 0.2" />
                </stop>
            </radialGradient>
            <mask id="lights_m" color="#000">
                <rect fill="url(#lights_gradient0)" width="28" height="28" x="-2" y="-2" />
            </mask>
        </defs>
        <g>
            <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="360 12 12; 0 12 12" />
            <g mask="url(#lights_m)">
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12; 45 12 12; 90 12 12; 135 12 12; 180 12 12; 225 12 12; 270 12 12; 315 12 12" />
                <path d="M12 12l8.4853-8.4853c-1.1053-1.1053-2.4252-1.996-3.8919-2.6042z" />
                <path opacity="0.9" transform="rotate(-45 12 12)" d="M12 12l8.4853-8.4853c-1.1053-1.1053-2.4252-1.996-3.8919-2.6042z" />
                <path opacity="0.8" transform="rotate(-90 12 12)" d="M12 12l8.4853-8.4853c-1.1053-1.1053-2.4252-1.996-3.8919-2.6042z" />
                <path opacity="0.7" transform="rotate(-135 12 12)" d="M12 12l8.4853-8.4853c-1.1053-1.1053-2.4252-1.996-3.8919-2.6042z" />
                <path opacity="0.6" transform="rotate(-180 12 12)" d="M12 12l8.4853-8.4853c-1.1053-1.1053-2.4252-1.996-3.8919-2.6042z" />
                <path opacity="0.5" transform="rotate(135 12 12)" d="M12 12l8.4853-8.4853c-1.1053-1.1053-2.4252-1.996-3.8919-2.6042z" />
                <path opacity="0.4" transform="rotate(90 12 12)" d="M12 12l8.4853-8.4853c-1.1053-1.1053-2.4252-1.996-3.8919-2.6042z" />
                <path opacity="0.3" transform="rotate(45 12 12)" d="M12 12l8.4853-8.4853c-1.1053-1.1053-2.4252-1.996-3.8919-2.6042z" />
            </g>
        </g>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>