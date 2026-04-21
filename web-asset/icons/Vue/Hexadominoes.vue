<template>
    <svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <g>
            <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
            <g>
                <line transform-origin="12 4" x1="9.5" x2="14.5" y1="4" y2="4">
                    <animateTransform id="hexadominoes_a0" attributeName="transform" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                </line>
                <line transform-origin="18.928203 8" x1="17.678203" x2="20.178203" y1="5.834936" y2="10.165064">
                    <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.1s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                </line>
                <line transform-origin="18.928203 16" x1="20.178203" x2="17.678203" y1="13.834936" y2="18.165064">
                    <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.2s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                </line>
                <line transform-origin="12 20" x1="14.5" x2="9.5" y1="20" y2="20">
                    <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.3s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                </line>
                <line transform-origin="5.071797 16" x1="6.321797" x2="3.821797" y1="18.165064" y2="13.834936">
                    <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.4s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                </line>
                <line transform-origin="5.071797 8" x1="3.821797" x2="6.321797" y1="10.165064" y2="5.834936">
                    <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.5s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                </line>
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