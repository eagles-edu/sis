import * as React from "react";

const styles = `
    :root, .palette0 {color: currentColor;
        --color0: #fff;
        --color1: #000;
    }
`;

function Windy(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="2s" keyTimes="0; 0.7; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 300 12 12; 360 12 12" />
                <line x1="12" x2="12" y1="6" y2="1">
                    <animate attributeName="x1" dur="2s" keyTimes="0; 0.4; 0.7; 1" repeatCount="indefinite" values="12; 17; 12; 12" />
                </line>
                <line transform="rotate(45 12 12)" x1="12" x2="12" y1="6" y2="1">
                    <animate attributeName="x1" dur="2s" keyTimes="0; 0.4; 0.7; 1" repeatCount="indefinite" values="12; 17; 12; 12" />
                </line>
                <line transform="rotate(90 12 12)" x1="12" x2="12" y1="6" y2="1">
                    <animate attributeName="x1" dur="2s" keyTimes="0; 0.4; 0.7; 1" repeatCount="indefinite" values="12; 17; 12; 12" />
                </line>
                <line transform="rotate(135 12 12)" x1="12" x2="12" y1="6" y2="1">
                    <animate attributeName="x1" dur="2s" keyTimes="0; 0.4; 0.7; 1" repeatCount="indefinite" values="12; 17; 12; 12" />
                </line>
                <line transform="rotate(180 12 12)" x1="12" x2="12" y1="6" y2="1">
                    <animate attributeName="x1" dur="2s" keyTimes="0; 0.4; 0.7; 1" repeatCount="indefinite" values="12; 17; 12; 12" />
                </line>
                <line transform="rotate(-135 12 12)" x1="12" x2="12" y1="6" y2="1">
                    <animate attributeName="x1" dur="2s" keyTimes="0; 0.4; 0.7; 1" repeatCount="indefinite" values="12; 17; 12; 12" />
                </line>
                <line transform="rotate(-90 12 12)" x1="12" x2="12" y1="6" y2="1">
                    <animate attributeName="x1" dur="2s" keyTimes="0; 0.4; 0.7; 1" repeatCount="indefinite" values="12; 17; 12; 12" />
                </line>
                <line transform="rotate(-45 12 12)" x1="12" x2="12" y1="6" y2="1">
                    <animate attributeName="x1" dur="2s" keyTimes="0; 0.4; 0.7; 1" repeatCount="indefinite" values="12; 17; 12; 12" />
                </line>
            </g>
        </svg>
    );
}

function JogglingCapsules(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="5s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <line strokeWidth="2" stroke="currentColor" strokeLinecap="round" x1="12" x2="12" y1="1" y2="8">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                    <animate attributeName="y1" dur="4s" repeatCount="indefinite" type="rotate" values="1; 5; 5; 1" />
                    <animate attributeName="y2" dur="4s" repeatCount="indefinite" type="rotate" values="8; 5; 5; 8" />
                    <animate attributeName="stroke-width" dur="4s" repeatCount="indefinite" type="rotate" values="2; 6; 6; 2" />
                </line>
                <g transform="rotate(120 12 12)">
                    <line strokeWidth="2" stroke="currentColor" strokeLinecap="round" x1="12" x2="12" y1="1" y2="8">
                        <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                        <animate attributeName="y1" dur="4s" repeatCount="indefinite" type="rotate" values="1; 5; 5; 1" />
                        <animate attributeName="y2" dur="4s" repeatCount="indefinite" type="rotate" values="8; 5; 5; 8" />
                        <animate attributeName="stroke-width" dur="4s" repeatCount="indefinite" type="rotate" values="2; 6; 6; 2" />
                    </line>
                </g>
                <g transform="rotate(-120 12 12)">
                    <line strokeWidth="2" stroke="currentColor" strokeLinecap="round" x1="12" x2="12" y1="1" y2="8">
                        <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                        <animate attributeName="y1" dur="4s" repeatCount="indefinite" type="rotate" values="1; 5; 5; 1" />
                        <animate attributeName="y2" dur="4s" repeatCount="indefinite" type="rotate" values="8; 5; 5; 8" />
                        <animate attributeName="stroke-width" dur="4s" repeatCount="indefinite" type="rotate" values="2; 6; 6; 2" />
                    </line>
                </g>
            </g>
        </svg>
    );
}

function JogglingLava(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="5s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <ellipse cx="12" cy="5" rx="2" ry="5">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                    <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="5; 2; 5" />
                    <animate attributeName="rx" dur="3s" repeatCount="indefinite" values="2; 5; 2" />
                </ellipse>
                <g transform="rotate(120 12 12)">
                    <ellipse cx="12" cy="5" rx="2" ry="5">
                        <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                        <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="5; 2; 5" />
                        <animate attributeName="rx" dur="3s" repeatCount="indefinite" values="2; 5; 2" />
                    </ellipse>
                </g>
                <g transform="rotate(-120 12 12)">
                    <ellipse cx="12" cy="5" rx="2" ry="5">
                        <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                        <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="5; 2; 5" />
                        <animate attributeName="rx" dur="3s" repeatCount="indefinite" values="2; 5; 2" />
                    </ellipse>
                </g>
            </g>
        </svg>
    );
}

function JogglingEllipses(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="5s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <ellipse cx="12" cy="5" rx="2" ry="5">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                </ellipse>
                <g transform="rotate(120 12 12)">
                    <ellipse cx="12" cy="5" rx="2" ry="5">
                        <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                    </ellipse>
                </g>
                <g transform="rotate(-120 12 12)">
                    <ellipse cx="12" cy="5" rx="2" ry="5">
                        <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                    </ellipse>
                </g>
            </g>
        </svg>
    );
}

function JogglingSticks(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <line transformOrigin="12 4" x1="12" x2="12" y1="1" y2="7">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360; 0" />
                </line>
                <line transformOrigin="20 12" x1="23" x2="17" y1="12" y2="12">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360; 0" />
                </line>
                <line transformOrigin="12 20" x1="12" x2="12" y1="23" y2="17">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360; 0" />
                </line>
                <line transformOrigin="4 12" x1="1" x2="7" y1="12" y2="12">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360; 0" />
                </line>
            </g>
        </svg>
    );
}

function JogglingTriangles(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="360 12 12; 0 12 12" />
                <polygon points="12 0 6.803848 9 17.196152 9" transformOrigin="12 6">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; 0; 0; 60; 60; 60; 120; 120" />
                </polygon>
                <polygon points="22.392305 18 17.196152 9 12 18" transformOrigin="17.196153 15">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; 0; 0; 60; 60; 60; 120; 120" />
                </polygon>
                <polygon points="1.607695 18 12 18 6.803848 9" transformOrigin="6.803848 15">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; 0; 0; 60; 60; 60; 120; 120" />
                </polygon>
            </g>
        </svg>
    );
}

function Train(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <circle cx="12" cy="2" r="2">
                    <animateTransform attributeName="transform" dur="4s" keyTimes="0; 0.2; 0.3; 0.35; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 0 12 12; 280 12 12; 360 12 12; 360 12 12" />
                </circle>
                <circle transform="rotate(30 12 12)" cx="12" cy="2" r="2">
                    <animateTransform attributeName="transform" dur="4s" keyTimes="0; 0.15; 0.3; 0.35; 1" repeatCount="indefinite" type="rotate" values="30 12 12; 30 12 12; 310 12 12; 390 12 12; 390 12 12" />
                </circle>
                <circle transform="rotate(60 12 12)" cx="12" cy="2" r="2">
                    <animateTransform attributeName="transform" dur="4s" keyTimes="0; 0.1; 0.3; 0.35; 1" repeatCount="indefinite" type="rotate" values="60 12 12; 60 12 12; 340 12 12; 420 12 12; 420 12 12" />
                </circle>
                <circle transform="rotate(90 12 12)" cx="12" cy="2" r="2">
                    <animateTransform attributeName="transform" dur="4s" keyTimes="0; 0.05; 0.3; 0.35; 1" repeatCount="indefinite" type="rotate" values="90 12 12; 90 12 12; 370 12 12; 450 12 12; 450 12 12" />
                </circle>
            </g>
        </svg>
    );
}

function SingularRipple(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle strokeWidth="2" stroke="currentColor" fill="none" cx="12" cy="12" r="3">
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="3; 11" />
                <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1; 0.7; 0" />
            </circle>
        </svg>
    );
}

function CollidingRipples(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="3">
                <animate attributeName="r" dur="2s" repeatCount="indefinite" values="2; 6; 2" />
                <animate attributeName="opacity" dur="2s" repeatCount="indefinite" values="0.5; 1; 0.5" />
            </circle>
            <circle cx="12" cy="12" r="3">
                <animate attributeName="r" dur="2s" repeatCount="indefinite" values="11; 8; 11" />
                <animate attributeName="opacity" dur="2s" repeatCount="indefinite" values="0; 1; 0" />
            </circle>
        </svg>
    );
}

function WaterRipples(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="1">
                <animate id="water_ripples_one" attributeName="r" dur="3s" repeatCount="indefinite" values="1; 11" />
                <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="1; 0" />
            </circle>
            <circle cx="12" cy="12" r="1">
                <animate attributeName="r" begin="water_ripples_one.begin+1s" dur="3s" repeatCount="indefinite" values="1; 11" />
                <animate attributeName="opacity" begin="water_ripples_one.begin+1s" dur="3s" repeatCount="indefinite" values="1; 0" />
            </circle>
            <circle cx="12" cy="12" r="1">
                <animate attributeName="r" begin="water_ripples_one.begin+2s" dur="3s" repeatCount="indefinite" values="1; 11" />
                <animate attributeName="opacity" begin="water_ripples_one.begin+2s" dur="3s" repeatCount="indefinite" values="1; 0" />
            </circle>
        </svg>
    );
}

function Stick(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 1; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
            </line>
            <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.9; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
            </line>
            <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.8; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
            </line>
            <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.7; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
            </line>
            <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.6; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
            </line>
        </svg>
    );
}

function RotationWave(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <circle cx="12" cy="3" r="2">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.4; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </circle>
                <circle cx="12" cy="9" r="2">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.5; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </circle>
                <circle cx="12" cy="15" r="2">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.6; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </circle>
                <circle cx="12" cy="21" r="2">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.7; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </circle>
            </g>
        </svg>
    );
}

function TrailingGhosts(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                <circle cx="12" cy="3" r="1.5">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 1; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                    <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1; 0" />
                </circle>
                <circle cx="12" cy="3" r="2">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.9; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                    <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1; 0" />
                </circle>
                <circle cx="12" cy="3" r="2.5">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.8; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                    <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1; 0" />
                </circle>
                <circle cx="12" cy="3" r="3">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.7; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                    <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1; 0" />
                </circle>
                <circle cx="12" cy="3" r="3">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.6; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </circle>
            </g>
        </svg>
    );
}

function CollidingBalls(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <circle cx="21" cy="12" r="3">
                    <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="21; 12; 21" />
                    <animate attributeName="r" dur="1s" keyTimes="0; 0.3; 0.5; 0.7; 1" repeatCount="indefinite" values="3; 3; 5; 3; 3" />
                </circle>
                <circle cx="3" cy="12" r="3">
                    <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="3; 12; 3" />
                    <animate attributeName="r" dur="1s" keyTimes="0; 0.3; 0.5; 0.7; 1" repeatCount="indefinite" values="3; 3; 5; 3; 3" />
                </circle>
            </g>
        </svg>
    );
}

function SmoothPulsingCircle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="2">
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="2; 12" />
                <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="0; 0.7; 0" />
            </circle>
        </svg>
    );
}

function CollidingSpotlights(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="3">
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="3; 12" />
                <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1; 0" />
            </circle>
            <circle cx="12" cy="12" r="3">
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="12; 3" />
                <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="0; 1" />
            </circle>
        </svg>
    );
}

function CollidingRotatingBalls(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <circle cx="21" cy="12" r="3">
                    <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="21; 12; 21" />
                    <animate attributeName="r" dur="1s" keyTimes="0; 0.3; 0.5; 0.7; 1" repeatCount="indefinite" values="3; 3; 5; 3; 3" />
                </circle>
                <circle cx="3" cy="12" r="3">
                    <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="3; 12; 3" />
                    <animate attributeName="r" dur="1s" keyTimes="0; 0.3; 0.5; 0.7; 1" repeatCount="indefinite" values="3; 3; 5; 3; 3" />
                </circle>
                <animateTransform attributeName="transform" dur="5s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function QuadLights(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <circle opacity="0.8" cx="21" cy="12" r="3">
                    <animate attributeName="cx" dur="2s" repeatCount="indefinite" values="21; 12; 21" />
                    <animate attributeName="r" dur="2s" repeatCount="indefinite" values="3; 2; 3" />
                </circle>
                <circle opacity="0.8" cx="3" cy="12" r="3">
                    <animate attributeName="cx" dur="2s" repeatCount="indefinite" values="3; 12; 3" />
                    <animate attributeName="r" dur="2s" repeatCount="indefinite" values="3; 2; 3" />
                </circle>
                <circle opacity="0.8" cx="12" cy="21" r="3">
                    <animate attributeName="cy" dur="2s" repeatCount="indefinite" values="21; 12; 21" />
                    <animate attributeName="r" dur="2s" repeatCount="indefinite" values="3; 2; 3" />
                </circle>
                <circle opacity="0.8" cx="12" cy="3" r="3">
                    <animate attributeName="cy" dur="2s" repeatCount="indefinite" values="3; 12; 3" />
                    <animate attributeName="r" dur="2s" repeatCount="indefinite" values="3; 2; 3" />
                </circle>
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function BreathingCircle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="3">
                <animate attributeName="r" dur="3s" repeatCount="indefinite" values="5; 11; 5" />
                <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="1; 0.5; 1" />
            </circle>
        </svg>
    );
}

function PulsingCircle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="3">
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="3; 12" />
                <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1; 0" />
            </circle>
        </svg>
    );
}

function Star(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <radialGradient id="star_gradient0">
                    <stop offset="10%" stopColor="currentColor" />
                    <stop offset="80%">
                        <animate attributeName="offset" dur="3s" repeatCount="indefinite" values="0.1; 2; 0.1;" />
                    </stop>
                </radialGradient>
                <mask id="star_m" color="#000">
                    <rect fill="url(#star_gradient0)" width="28" height="28" x="-2" y="-2" />
                </mask>
            </defs>
            <g mask="url(#star_m)">
                <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <polygon strokeWidth="1.5" stroke="currentColor" fill="none" points="12 1 12 12 6.5 2.473725 12 12 2.473725 6.5 12 12 1 12 12 12 2.473725 17.5 12 12 6.5 21.526275 12 12 12 23 12 12 17.5 21.526275 12 12 21.526275 17.5 12 12 23 12 12 12 21.526275 6.5 12 12 17.5 2.473725 12 12" />
            </g>
        </svg>
    );
}

function RadialBlur(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle fill="url(#radial_blur_pending_gradient0)" cx="12" cy="12" r="12" />
            <defs>
                <radialGradient id="radial_blur_pending_gradient0">
                    <stop offset="20%" stopColor="currentColor" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0">
                        <animate attributeName="offset" dur="1s" repeatCount="indefinite" values="0.2; 1; 0.2" />
                    </stop>
                </radialGradient>
            </defs>
        </svg>
    );
}

function EclipsedDots(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <linearGradient id="eclipsed_dots_gradient0">
                    <stop offset="25%" />
                    <stop offset="100%" stopColor="currentColor" />
                </linearGradient>
                <mask id="eclipsed_dots_m" color="#000">
                    <rect fill="url(#eclipsed_dots_gradient0)" width="100%" height="100%" />
                </mask>
            </defs>
            <g mask="url(#eclipsed_dots_m)">
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <g>
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 12; 0 12 12" />
                    <circle cx="12" cy="2" r="2" />
                    <circle transform="rotate(30 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(60 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(90 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(120 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(150 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(180 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(-150 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(-120 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(-90 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(-60 12 12)" cx="12" cy="2" r="2" />
                    <circle transform="rotate(-30 12 12)" cx="12" cy="2" r="2" />
                </g>
            </g>
        </svg>
    );
}

function EllipsisBouncingStretched(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <ellipse cx="4" cy="12" rx="2" ry="2">
                <animate attributeName="rx" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="2; 3; 2; 2" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
                <animate attributeName="ry" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="2; 6; 2; 2" />
            </ellipse>
            <ellipse cx="12" cy="12" rx="2" ry="2">
                <animate attributeName="rx" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="2; 3; 2; 2" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
                <animate attributeName="ry" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="2; 6; 2; 2" />
            </ellipse>
            <ellipse cx="20" cy="12" rx="2" ry="2">
                <animate attributeName="rx" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="2; 3; 2; 2" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
                <animate attributeName="ry" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="2; 6; 2; 2" />
            </ellipse>
        </svg>
    );
}

function Ellipsis(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="4" cy="12" r="2">
                <animate attributeName="opacity" dur="2s" keyTimes="0; 0.25; 0.25; 1" repeatCount="indefinite" values="0; 0; 1; 1" />
            </circle>
            <circle cx="12" cy="12" r="2">
                <animate attributeName="opacity" dur="2s" keyTimes="0; 0.5; 0.5; 1" repeatCount="indefinite" values="0; 0; 1; 1" />
            </circle>
            <circle cx="20" cy="12" r="2">
                <animate attributeName="opacity" dur="2s" keyTimes="0; 0.75; 0.75; 1" repeatCount="indefinite" values="0; 0; 1; 1" />
            </circle>
        </svg>
    );
}

function Hexadominoes(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <g>
                    <line transformOrigin="12 4" x1="9.5" x2="14.5" y1="4" y2="4">
                        <animateTransform id="hexadominoes_a0" attributeName="transform" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                    </line>
                    <line transformOrigin="18.928203 8" x1="17.678203" x2="20.178203" y1="5.834936" y2="10.165064">
                        <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.1s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                    </line>
                    <line transformOrigin="18.928203 16" x1="20.178203" x2="17.678203" y1="13.834936" y2="18.165064">
                        <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.2s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                    </line>
                    <line transformOrigin="12 20" x1="14.5" x2="9.5" y1="20" y2="20">
                        <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.3s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                    </line>
                    <line transformOrigin="5.071797 16" x1="6.321797" x2="3.821797" y1="18.165064" y2="13.834936">
                        <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.4s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                    </line>
                    <line transformOrigin="5.071797 8" x1="3.821797" x2="6.321797" y1="10.165064" y2="5.834936">
                        <animateTransform attributeName="transform" begin="hexadominoes_a0.begin+0.5s" dur="3.6s" keyTimes="0; 0.1; 0.5; 0.6; 1" repeatCount="indefinite" type="rotate" values="0; 90; 90; 180; 180" />
                    </line>
                </g>
            </g>
        </svg>
    );
}

function MorphingHexagon(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12; 60 12 12; 120 12 12; 180 12 12; 240 12 12; 300 12 12" />
                <line transformOrigin="12 4" x1="9.5" x2="14.5" y1="4" y2="4">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; -90; -90; -180; -180" />
                </line>
                <line opacity="0.25" transformOrigin="18.928203 8" x1="17.678203" x2="20.178203" y1="5.834936" y2="10.165064">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; -90; -90; -180; -180" />
                </line>
                <line opacity="0.4" transformOrigin="18.928203 16" x1="20.178203" x2="17.678203" y1="13.834936" y2="18.165064">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; -90; -90; -180; -180" />
                </line>
                <line opacity="0.55" transformOrigin="12 20" x1="14.5" x2="9.5" y1="20" y2="20">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; -90; -90; -180; -180" />
                </line>
                <line opacity="0.7" transformOrigin="5.071797 16" x1="6.321797" x2="3.821797" y1="18.165064" y2="13.834936">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; -90; -90; -180; -180" />
                </line>
                <line opacity="0.85" transformOrigin="5.071797 8" x1="3.821797" x2="6.321797" y1="10.165064" y2="5.834936">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; -90; -90; -180; -180" />
                </line>
            </g>
        </svg>
    );
}

function OctafadeShort(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <path d="M12 2a1 1 0.7854 0 1 0.7071 0.2929C13 2.5858 13 2.9497 13 3.3137v1.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V3.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 2z" />
                <path opacity="0.3" transform="rotate(45 12 12)" d="M12 2a1 1 0.7854 0 1 0.7071 0.2929C13 2.5858 13 2.9497 13 3.3137v1.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V3.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 2z" />
                <path opacity="0.4" d="M22 12a1 1 0.7854 0 1-0.2929 0.7071C21.4142 13 21.0503 13 20.6863 13h-1.3726c-0.364 0-0.7279 0-1.0208-0.2929A1 1 0.7854 0 1 18 12a1 1 0.7854 0 1 0.2929-0.7071C18.5858 11 18.9497 11 19.3137 11h1.3726c0.364 0 0.7279 0 1.0208 0.2929A1 1 0.7854 0 1 22 12z" />
                <path opacity="0.5" transform="rotate(135 12 12)" d="M12 2a1 1 0.7854 0 1 0.7071 0.2929C13 2.5858 13 2.9497 13 3.3137v1.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V3.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 2z" />
                <path opacity="0.6" transform="rotate(180 12 12)" d="M12 2a1 1 0.7854 0 1 0.7071 0.2929C13 2.5858 13 2.9497 13 3.3137v1.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V3.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 2z" />
                <path opacity="0.7" transform="rotate(-135 12 12)" d="M12 2a1 1 0.7854 0 1 0.7071 0.2929C13 2.5858 13 2.9497 13 3.3137v1.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V3.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 2z" />
                <path opacity="0.8" d="M2 12a1 1 0.7854 0 1 0.2929-0.7071C2.5858 11 2.9497 11 3.3137 11h1.3726c0.364 0 0.7279 0 1.0208 0.2929A1 1 0.7854 0 1 6 12a1 1 0.7854 0 1-0.2929 0.7071C5.4142 13 5.0503 13 4.6863 13H3.3137c-0.364 0-0.7279 0-1.0208-0.2929A1 1 0.7854 0 1 2 12z" />
                <path opacity="0.9" transform="rotate(-45 12 12)" d="M12 2a1 1 0.7854 0 1 0.7071 0.2929C13 2.5858 13 2.9497 13 3.3137v1.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V3.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 2z" />
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;45 12 12; 90 12 12; 135 12 12; 180 12 12; 225 12 12; 270 12 12; 315 12 12" />
            </g>
        </svg>
    );
}

function EllipsisBouncingHighlight(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="4" cy="12" r="2">
                <animate attributeName="r" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="2; 4; 2; 2" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
                <animate attributeName="cy" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="12; 5; 12; 12" />
            </circle>
            <circle cx="12" cy="12" r="2">
                <animate attributeName="r" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="2; 4; 2; 2" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
                <animate attributeName="cy" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="12; 5; 12; 12" />
            </circle>
            <circle cx="20" cy="12" r="2">
                <animate attributeName="r" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="2; 4; 2; 2" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
                <animate attributeName="cy" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="12; 5; 12; 12" />
            </circle>
        </svg>
    );
}

function EllipsisHighlight(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="4" cy="12" r="2">
                <animate attributeName="r" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="2; 4; 2; 2" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
            </circle>
            <circle cx="12" cy="12" r="2">
                <animate attributeName="r" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="2; 4; 2; 2" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
            </circle>
            <circle cx="20" cy="12" r="2">
                <animate attributeName="r" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="2; 4; 2; 2" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
            </circle>
        </svg>
    );
}

function OctafadeMedium(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <path d="M12 1a1 1 0.7854 0 1 0.7071 0.2929C13 1.5858 13 1.9497 13 2.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 7a1 1 0.7854 0 1-0.7071-0.2929C11 6.4142 11 6.0503 11 5.6863V2.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 1z" />
                <path opacity="0.3" transform="rotate(45 12 12)" d="M12 1a1 1 0.7854 0 1 0.7071 0.2929C13 1.5858 13 1.9497 13 2.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 7a1 1 0.7854 0 1-0.7071-0.2929C11 6.4142 11 6.0503 11 5.6863V2.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 1z" />
                <path opacity="0.4" transform="rotate(90 12 12)" d="M12 1a1 1 0.7854 0 1 0.7071 0.2929C13 1.5858 13 1.9497 13 2.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 7a1 1 0.7854 0 1-0.7071-0.2929C11 6.4142 11 6.0503 11 5.6863V2.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 1z" />
                <path opacity="0.5" transform="rotate(135 12 12)" d="M12 1a1 1 0.7854 0 1 0.7071 0.2929C13 1.5858 13 1.9497 13 2.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 7a1 1 0.7854 0 1-0.7071-0.2929C11 6.4142 11 6.0503 11 5.6863V2.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 1z" />
                <path opacity="0.6" transform="rotate(180 12 12)" d="M12 1a1 1 0.7854 0 1 0.7071 0.2929C13 1.5858 13 1.9497 13 2.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 7a1 1 0.7854 0 1-0.7071-0.2929C11 6.4142 11 6.0503 11 5.6863V2.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 1z" />
                <path opacity="0.7" transform="rotate(-135 12 12)" d="M12 1a1 1 0.7854 0 1 0.7071 0.2929C13 1.5858 13 1.9497 13 2.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 7a1 1 0.7854 0 1-0.7071-0.2929C11 6.4142 11 6.0503 11 5.6863V2.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 1z" />
                <path opacity="0.8" transform="rotate(-90 12 12)" d="M12 1a1 1 0.7854 0 1 0.7071 0.2929C13 1.5858 13 1.9497 13 2.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 7a1 1 0.7854 0 1-0.7071-0.2929C11 6.4142 11 6.0503 11 5.6863V2.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 1z" />
                <path opacity="0.9" transform="rotate(-45 12 12)" d="M12 1a1 1 0.7854 0 1 0.7071 0.2929C13 1.5858 13 1.9497 13 2.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 7a1 1 0.7854 0 1-0.7071-0.2929C11 6.4142 11 6.0503 11 5.6863V2.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 1z" />
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;45 12 12; 90 12 12; 135 12 12; 180 12 12; 225 12 12; 270 12 12; 315 12 12" />
            </g>
        </svg>
    );
}

function OctafadeLong(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <path d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v5.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 8a1 1 0.7854 0 1-0.7071-0.2929C11 7.4142 11 7.0503 11 6.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.3" transform="rotate(45 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v5.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 8a1 1 0.7854 0 1-0.7071-0.2929C11 7.4142 11 7.0503 11 6.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.4" transform="rotate(90 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v5.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 8a1 1 0.7854 0 1-0.7071-0.2929C11 7.4142 11 7.0503 11 6.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.5" transform="rotate(135 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v5.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 8a1 1 0.7854 0 1-0.7071-0.2929C11 7.4142 11 7.0503 11 6.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.6" transform="rotate(180 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v5.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 8a1 1 0.7854 0 1-0.7071-0.2929C11 7.4142 11 7.0503 11 6.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.7" transform="rotate(-135 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v5.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 8a1 1 0.7854 0 1-0.7071-0.2929C11 7.4142 11 7.0503 11 6.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.8" transform="rotate(-90 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v5.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 8a1 1 0.7854 0 1-0.7071-0.2929C11 7.4142 11 7.0503 11 6.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.9" transform="rotate(-45 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v5.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 8a1 1 0.7854 0 1-0.7071-0.2929C11 7.4142 11 7.0503 11 6.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;45 12 12; 90 12 12; 135 12 12; 180 12 12; 225 12 12; 270 12 12; 315 12 12" />
            </g>
        </svg>
    );
}

function EllipsisWave(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="4" cy="12" r="2">
                <animate attributeName="r" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="2; 4; 2; 2" />
            </circle>
            <circle cx="12" cy="12" r="2">
                <animate attributeName="r" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="2; 4; 2; 2" />
            </circle>
            <circle cx="20" cy="12" r="2">
                <animate attributeName="r" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="2; 4; 2; 2" />
            </circle>
        </svg>
    );
}

function Rings(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g strokeLinecap="butt" strokeLinejoin="miter">
                <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <ellipse cx="12" cy="4" rx="0.1" ry="3">
                    <animate attributeName="rx" dur="1.5s" repeatCount="indefinite" values="0.1; 3; 0.1" />
                </ellipse>
                <ellipse transform="rotate(60 12 12)" cx="12" cy="4" rx="0.1" ry="3">
                    <animate attributeName="rx" dur="1.5s" repeatCount="indefinite" values="0.1; 3; 0.1" />
                </ellipse>
                <ellipse transform="rotate(120 12 12)" cx="12" cy="4" rx="0.1" ry="3">
                    <animate attributeName="rx" dur="1.5s" repeatCount="indefinite" values="0.1; 3; 0.1" />
                </ellipse>
                <ellipse transform="rotate(180 12 12)" cx="12" cy="4" rx="0.1" ry="3">
                    <animate attributeName="rx" dur="1.5s" repeatCount="indefinite" values="0.1; 3; 0.1" />
                </ellipse>
                <ellipse transform="rotate(-120 12 12)" cx="12" cy="4" rx="0.1" ry="3">
                    <animate attributeName="rx" dur="1.5s" repeatCount="indefinite" values="0.1; 3; 0.1" />
                </ellipse>
                <ellipse transform="rotate(-60 12 12)" cx="12" cy="4" rx="0.11" ry="3">
                    <animate attributeName="rx" dur="1.5s" repeatCount="indefinite" values="0.1; 3; 0.1" />
                </ellipse>
            </g>
        </svg>
    );
}

function Sphere(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <radialGradient id="sphere_gradient0">
                    <stop offset="70%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="100%" stopColor="currentColor" />
                </radialGradient>
            </defs>
            <path opacity="1" d="M12 24c-4.4183 0-8-5.3726-8-12S7.5817 0 12 0C5.3726 0 0 5.3726 0 12s5.3726 12 12 12z">
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0; 0; 0.3; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
            </path>
            <path opacity="0" d="M12 0C7.5817 0 4 5.3726 4 12s3.5817 12 8 12c-1.6569 0-3-5.3726-3-12s1.3431-12 3-12z">
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.1; 0.1; 0.4; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
            </path>
            <ellipse opacity="0" cx="12" cy="12" rx="3" ry="12">
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.2; 0.2; 0.5; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
            </ellipse>
            <path opacity="0" transform="matrix(-1, 0, 0, 1, 24, 0)" d="M12 24c-1.6569 0-3-5.3726-3-12s1.3431-12 3-12C7.5817 0 4 5.3726 4 12s3.5817 12 8 12z">
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.3; 0.3; 0.6; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
            </path>
            <path opacity="0" transform="matrix(-1, 0, 0, 1, 24, 0)" d="M12 0C5.3726 0 0 5.3726 0 12s5.3726 12 12 12c-4.4183 0-8-5.3726-8-12S7.5817 0 12 0z">
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.4; 0.4; 0.7; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
            </path>
            <circle opacity="0.5" fill="url(#sphere_gradient0)" cx="12" cy="12" r="12">
                <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="0.5; 0.2; 0.7; 0.5" />
            </circle>
        </svg>
    );
}

function Tangled(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <ellipse cx="12" cy="12" rx="11" ry="4">
                    <animate attributeName="ry" dur="2s" repeatCount="indefinite" values="4; 0.1; 4; 4" />
                </ellipse>
                <ellipse transform="rotate(-90 12 12)" cx="12" cy="12" rx="11" ry="4">
                    <animate attributeName="ry" dur="2s" repeatCount="indefinite" values="4; 0.1; 0.1; 4" />
                </ellipse>
            </g>
        </svg>
    );
}

function Hexablossom(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <polyline points="9.5 4 12 4 14.5 4">
                    <animate id="hexablossom_a0" attributeName="points" dur="4s" keyTimes="0; 0.1; 0.4; 0.5; 1" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(60 12 12)" points="9.5 4 12 4 14.5 4">
                    <animate attributeName="points" begin="hexablossom_a0.begin+0.1s" dur="4s" keyTimes="0; 0.1; 0.4; 0.5; 1" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(120 12 12)" points="9.5 4 12 4 14.5 4">
                    <animate attributeName="points" begin="hexablossom_a0.begin+0.2s" dur="4s" keyTimes="0; 0.1; 0.4; 0.5; 1" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(180 12 12)" points="9.5 4 12 4 14.5 4">
                    <animate attributeName="points" begin="hexablossom_a0.begin+0.3s" dur="4s" keyTimes="0; 0.1; 0.4; 0.5; 1" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(-120 12 12)" points="9.5 4 12 4 14.5 4">
                    <animate attributeName="points" begin="hexablossom_a0.begin+0.4s" dur="4s" keyTimes="0; 0.1; 0.4; 0.5; 1" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(-60 12 12)" points="9.5 4 12 4 14.5 4">
                    <animate attributeName="points" begin="hexablossom_a0.begin+0.5s" dur="4s" keyTimes="0; 0.1; 0.4; 0.5; 1" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
            </g>
        </svg>
    );
}

function Hexastar(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <polyline points="9.5 4 12 1 14.5 4">
                    <animate attributeName="points" dur="3s" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 7 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(60 12 12)" points="9.5 4 12 1 14.5 4">
                    <animate attributeName="points" dur="3s" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 7 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(120 12 12)" points="9.5 4 12 1 14.5 4">
                    <animate attributeName="points" dur="3s" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 7 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(180 12 12)" points="9.5 4 12 1 14.5 4">
                    <animate attributeName="points" dur="3s" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 7 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(-120 12 12)" points="9.5 4 12 1 14.5 4">
                    <animate attributeName="points" dur="3s" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 7 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
                <polyline transform="rotate(-60 12 12)" points="9.5 4 12 1 14.5 4">
                    <animate attributeName="points" dur="3s" repeatCount="indefinite" values="9.5 4 12 4 14.5 4; 9.5 4 12 1 14.5 4; 9.5 4 12 4 14.5 4; 9.5 4 12 7 14.5 4; 9.5 4 12 4 14.5 4" />
                </polyline>
            </g>
        </svg>
    );
}

function Sticks(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g transform="rotate(-45 12 12)">
                <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.9; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </line>
                <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.8; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </line>
                <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 1; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </line>
            </g>
            <g transform="rotate(45 12 12)">
                <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.9; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </line>
                <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.8; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </line>
                <line opacity="0.7" x1="12" x2="12" y1="1" y2="23">
                    <animateTransform attributeName="transform" dur="1s" keyTimes="0; 1; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12; 360 12 12" />
                </line>
            </g>
        </svg>
    );
}

function EclipsedCrescent(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <radialGradient id="eclipsed_crescent_gradient0" gradientTransform="rotate(5.625 0.5 0.5)">
                    <stop offset="73%" stopColor="currentColor" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="eclipsed_crescent_gradient2" gradientTransform="rotate(90 0.25 0.25)">
                    <stop offset="0%" stopColor="currentColor" />
                    <stop offset="80%" stopColor="currentColor" />
                </linearGradient>
                <radialGradient id="eclipsed_crescent_gradient1">
                    <stop offset="0%" />
                    <stop offset="45%" stopColor="currentColor" />
                </radialGradient>
                <mask id="eclipsed_crescent_m" color="#000">
                    <rect fill="url(#eclipsed_crescent_gradient1)" width="24" height="24" />
                    <rect fill="url(#eclipsed_crescent_gradient2)" width="24" height="24" />
                </mask>
            </defs>
            <path strokeWidth="5" fill="url(#eclipsed_crescent_gradient0)" d="M24 12c0-6.6274-5.3726-12-12-12S0 5.3726 0 12 5.3726 24 12 24s12-5.3726 12-12zM4 12c0-4.4183 3.5817-8 8-8s8 3.5817 8 8-3.5817 8-8 8-8-3.5817-8-8z" mask="url(#eclipsed_crescent_m)">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </path>
        </svg>
    );
}

function MorphingEllipse(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <ellipse cx="12" cy="12" rx="3" ry="7">
                <animate attributeName="rx" dur="3s" repeatCount="indefinite" values="0; 10; 0" />
                <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="10; 0; 10" />
            </ellipse>
        </svg>
    );
}

function VerticalBounce(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g transform="rotate(90 12 12)">
                <ellipse cx="12" cy="12" rx="6" ry="3">
                    <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="3; 21; 3" />
                    <animate attributeName="rx" dur="0.5s" repeatCount="indefinite" values="3; 6; 6; 3" />
                    <animate attributeName="ry" dur="0.5s" repeatCount="indefinite" values="6; 3; 3; 3; 6" />
                </ellipse>
            </g>
        </svg>
    );
}

function FadingCrescent(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <radialGradient id="fading_crescent_gradient1">
                    <stop offset="65%" stopColor="currentColor" />
                    <stop offset="100%" stopColor="currentColor" />
                </radialGradient>
                <linearGradient id="fading_crescent_gradient0" gradientTransform="rotate(90 0.25 0.25)">
                    <stop offset="0%" stopColor="currentColor" />
                    <stop offset="85%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
                <mask id="fading_crescent_m" color="#000">
                    <rect fill="url(#fading_crescent_gradient1)" width="24" height="24" x="0" y="0" />
                </mask>
            </defs>
            <circle strokeWidth="5" fill="url(#fading_crescent_gradient0)" cx="12" cy="12" mask="url(#fading_crescent_m)" r="12">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </circle>
        </svg>
    );
}

function ResizingFadingRing(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs strokeWidth="1">
                <linearGradient id="resizing_fading_ring_gradient0" gradientTransform="rotate(90 0.25 0.25)">
                    <stop offset="0%" stopColor="currentColor" />
                    <stop offset="61%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
            </defs>
            <g fill="none" transformOrigin="12 12">
                <circle stroke="url(#resizing_fading_ring_gradient0)" cx="12" cy="12" r="10.5">
                    <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                </circle>
                <circle opacity="0.2" stroke="currentColor" cx="12" cy="12" r="10.5" />
                <animateTransform attributeName="transform" dur="5s" repeatCount="indefinite" type="scale" values="1; 0.5; 1" />
            </g>
        </svg>
    );
}

function HorizontalBounce(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <ellipse cx="12" cy="12" rx="6" ry="3">
                <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="3; 21; 3" />
                <animate attributeName="rx" dur="0.5s" repeatCount="indefinite" values="3; 6; 6; 3" />
                <animate attributeName="ry" dur="0.5s" repeatCount="indefinite" values="6; 3; 3; 3; 6" />
            </ellipse>
        </svg>
    );
}

function FarClose(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="3">
                <animate attributeName="cx" dur="2s" repeatCount="indefinite" values="2; 22; 2" />
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="2; 7; 2" />
            </circle>
        </svg>
    );
}

function FadingRing(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <linearGradient id="fading_ring_gradient0" gradientTransform="rotate(90 0.25 0.25)">
                    <stop offset="0%" stopColor="currentColor" />
                    <stop offset="80%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
            </defs>
            <circle strokeWidth="3" stroke="url(#fading_ring_gradient0)" fill="none" cx="12" cy="12" r="10.5">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </circle>
        </svg>
    );
}

function FadingBarsWave(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <rect opacity="0.5" width="4" height="8" x="3" y="8">
                <animate attributeName="height" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="8; 22; 8; 8" />
                <animate attributeName="y" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="8; 1; 8; 8" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
            </rect>
            <rect opacity="0.5" width="4" height="8" x="10" y="8">
                <animate attributeName="height" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="8; 22; 8; 8" />
                <animate attributeName="y" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="8; 1; 8; 8" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
            </rect>
            <rect opacity="0.5" strokeWidth="1" width="4" height="8" x="17" y="8">
                <animate attributeName="height" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="8; 22; 8; 8" />
                <animate attributeName="y" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="8; 1; 8; 8" />
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="0.5; 1; 0.5; 0.5" />
            </rect>
        </svg>
    );
}

function Traffic(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="3" cy="12" r="3">
                <animate attributeName="opacity" dur="3s" keyTimes="0; 0; 0.15; 0.3; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
                <animate attributeName="cx" dur="3s" keyTimes="0; 0; 0.3; 1" repeatCount="indefinite" values="3; 3; 21; 21" />
            </circle>
            <circle cx="3" cy="12" r="3">
                <animate attributeName="opacity" dur="3s" keyTimes="0; 0.1; 0.25; 0.4; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
                <animate attributeName="cx" dur="3s" keyTimes="0; 0.1; 0.4; 1" repeatCount="indefinite" values="3; 3; 21; 21" />
            </circle>
            <circle cx="3" cy="12" r="3">
                <animate attributeName="opacity" dur="3s" keyTimes="0; 0.2; 0.35; 0.5; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
                <animate attributeName="cx" dur="3s" keyTimes="0; 0.2; 0.5; 1" repeatCount="indefinite" values="3; 3; 21; 21" />
            </circle>
            <circle cx="3" cy="12" r="3">
                <animate attributeName="opacity" dur="3s" keyTimes="0; 0.3; 0.45; 0.6; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
                <animate attributeName="cx" dur="3s" keyTimes="0; 0.3; 0.6; 1" repeatCount="indefinite" values="3; 3; 21; 21" />
            </circle>
            <circle cx="3" cy="12" r="3">
                <animate attributeName="opacity" dur="3s" keyTimes="0; 0.4; 0.55; 0.7; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
                <animate attributeName="cx" dur="3s" keyTimes="0; 0.4; 0.7; 1" repeatCount="indefinite" values="3; 3; 21; 21" />
            </circle>
            <circle cx="3" cy="12" r="3">
                <animate attributeName="opacity" dur="3s" keyTimes="0; 0.5; 0.65; 0.8; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
                <animate attributeName="cx" dur="3s" keyTimes="0; 0.5; 0.8; 1" repeatCount="indefinite" values="3; 3; 21; 21" />
            </circle>
            <circle cx="3" cy="12" r="3">
                <animate attributeName="opacity" dur="3s" keyTimes="0; 0.6; 0.75; 0.9; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
                <animate attributeName="cx" dur="3s" keyTimes="0; 0.6; 0.9; 1" repeatCount="indefinite" values="3; 3; 21; 21" />
            </circle>
            <circle cx="3" cy="12" r="3">
                <animate attributeName="opacity" dur="3s" keyTimes="0; 0.7; 0.85; 1; 1" repeatCount="indefinite" values="0; 0; 1; 0; 0" />
                <animate attributeName="cx" dur="3s" keyTimes="0; 0.7; 1; 1" repeatCount="indefinite" values="3; 3; 21; 21" />
            </circle>
        </svg>
    );
}

function TrafficContinuous(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle opacity="0.5" cx="3" cy="12" r="3">
                <animate id="traffic_continuous_one" attributeName="opacity" dur="1.8s" repeatCount="indefinite" values="0; 1; 0" />
                <animate attributeName="cx" dur="1.8s" repeatCount="indefinite" values="3; 21" />
            </circle>
            <circle opacity="0" cx="3" cy="12" r="3">
                <animate attributeName="opacity" begin="traffic_continuous_one.begin+0.6s" dur="1.8s" repeatCount="indefinite" values="0; 1; 0" />
                <animate attributeName="cx" begin="traffic_continuous_one.begin+0.6s" dur="1.8s" repeatCount="indefinite" values="3; 21" />
            </circle>
            <circle opacity="0" cx="3" cy="12" r="3">
                <animate attributeName="opacity" begin="traffic_continuous_one.begin+1.2s" dur="1.8s" repeatCount="indefinite" values="0; 1; 0" />
                <animate attributeName="cx" begin="traffic_continuous_one.begin+1.2s" dur="1.8s" repeatCount="indefinite" values="3; 21" />
            </circle>
        </svg>
    );
}

function BarsWave(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <rect width="4" height="8" x="3" y="8">
                <animate attributeName="height" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="8; 22; 8; 8" />
                <animate attributeName="y" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="8; 1; 8; 8" />
            </rect>
            <rect width="4" height="8" x="10" y="8">
                <animate attributeName="height" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="8; 22; 8; 8" />
                <animate attributeName="y" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="8; 1; 8; 8" />
            </rect>
            <rect strokeWidth="1" width="4" height="8" x="17" y="8">
                <animate attributeName="height" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="8; 22; 8; 8" />
                <animate attributeName="y" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="8; 1; 8; 8" />
            </rect>
        </svg>
    );
}

function Bars(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <rect width="3" height="8" x="3" y="8">
                <animate attributeName="height" dur="1s" repeatCount="indefinite" values="8; 16; 8" />
                <animate attributeName="y" dur="1s" repeatCount="indefinite" values="8; 4; 8" />
            </rect>
            <rect width="3" height="16" x="8" y="4">
                <animate attributeName="height" dur="1s" repeatCount="indefinite" values="16; 8; 16" />
                <animate attributeName="y" dur="1s" repeatCount="indefinite" values="4; 8; 4" />
            </rect>
            <rect width="3" height="8" x="13" y="8">
                <animate attributeName="height" dur="1s" repeatCount="indefinite" values="8; 16; 8" />
                <animate attributeName="y" dur="1s" repeatCount="indefinite" values="8; 4; 8" />
            </rect>
            <rect width="3" height="16" x="18" y="4">
                <animate attributeName="height" dur="1s" repeatCount="indefinite" values="16; 8; 16" />
                <animate attributeName="y" dur="1s" repeatCount="indefinite" values="4; 8; 4" />
            </rect>
        </svg>
    );
}

function BigBouncingEllipsis(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="4" cy="12" r="3">
                <animate attributeName="cy" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="12; 5; 12; 12" />
            </circle>
            <circle cx="12" cy="12" r="3">
                <animate attributeName="cy" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="12; 5; 12; 12" />
            </circle>
            <circle cx="20" cy="12" r="3">
                <animate attributeName="cy" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="12; 5; 12; 12" />
            </circle>
        </svg>
    );
}

function BigEllipsis(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="4" cy="12" r="3">
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.1666; 0.333; 1" repeatCount="indefinite" values="0.4; 1; 0.4; 0.4" />
            </circle>
            <circle cx="12" cy="12" r="3">
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.25; 0.5833; 1" repeatCount="indefinite" values="0.4; 1; 0.4; 0.4" />
            </circle>
            <circle cx="20" cy="12" r="3">
                <animate attributeName="opacity" dur="1s" keyTimes="0; 0.4166; 0.75; 1" repeatCount="indefinite" values="0.4; 1; 0.4; 0.4" />
            </circle>
        </svg>
    );
}

function MorphingSparkle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <polygon strokeLinecap="round" strokeLinejoin="round" points="23 12 15 9 12 1 9 9 1 12 9 15 12 23 15 15">
                <animate attributeName="points" dur="3s" repeatCount="indefinite" values="23 12 17.5 6.5 12 1 6.5 6.5 1 12 6.5 17.5 12 23 17.5 17.5; 23 12 12 12 12 1 12 12 1 12 12 12 12 23 12 12; 23 12 17.5 6.5 12 1 6.5 6.5 1 12 6.5 17.5 12 23 17.5 17.5" />
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </polygon>
        </svg>
    );
}

function DualDynamicTails(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="url(#dual_dynamic_tails_gradient1)" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs strokeWidth="1" stroke="none" strokeLinecap="butt" fill="currentColor">
                <linearGradient id="dual_dynamic_tails_gradient0" gradientTransform="rotate(90 0.25 0.25)">
                    <stop offset="0%" stopColor="currentColor" />
                    <stop offset="61%" stopColor="currentColor" stopOpacity="0">
                        <animate attributeName="offset" dur="1.5s" repeatCount="indefinite" values="1.5; 0.25; 0.25; 1.5" />
                    </stop>
                </linearGradient>
                <linearGradient id="dual_dynamic_tails_gradient1" gradientTransform="rotate(120 0.355662 0.25)" xlinkHref="#dual_dynamic_tails_gradient0" />
            </defs>
            <path d="M12 22.5C6.201 22.5 1.5 17.799 1.5 12S6.201 1.5 12 1.5">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </path>
            <path transform="rotate(180 12 12)" d="M12 22.5C6.201 22.5 1.5 17.799 1.5 12S6.201 1.5 12 1.5">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="180 12 12; 540 12 12" />
            </path>
        </svg>
    );
}

function ComplementingFadingArcs(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <circle cx="12" cy="12" r="10.5" strokeDasharray="10 66">
                    <animate attributeName="stroke-dasharray" dur="3s" repeatCount="indefinite" values="10 66; 46 66; 10 66" />
                    <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="0.4; 1; 0.4" />
                </circle>
                <g transform="rotate(142 12 12)">
                    <circle transform="matrix(-1, 0, 0, 1, 24, 0)" cx="12" cy="12" r="10.5" strokeDasharray="42 66">
                        <animate attributeName="stroke-dasharray" dur="3s" repeatCount="indefinite" values="42 66; 6 66; 42 66" />
                        <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="1; 0.4; 1" />
                    </circle>
                </g>
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function EllipticCircles(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g strokeWidth="0" fill="currentColor">
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <ellipse cx="12" cy="4" rx="2" ry="2">
                    <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="4; 2; 2; 2; 2; 4" />
                </ellipse>
                <ellipse transform="rotate(45 12 12)" cx="12" cy="4" rx="2" ry="2">
                    <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="4; 2; 2; 2; 2; 4" />
                </ellipse>
                <ellipse transform="rotate(90 12 12)" cx="12" cy="4" rx="2" ry="2">
                    <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="4; 2; 2; 2; 2; 4" />
                </ellipse>
                <ellipse transform="rotate(135 12 12)" cx="12" cy="4" rx="2" ry="2">
                    <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="4; 2; 2; 2; 2; 4" />
                </ellipse>
                <ellipse transform="rotate(180 12 12)" cx="12" cy="4" rx="2" ry="2">
                    <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="4; 2; 2; 2; 2; 4" />
                </ellipse>
                <ellipse transform="rotate(-135 12 12)" cx="12" cy="4" rx="2" ry="2">
                    <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="4; 2; 2; 2; 2; 4" />
                </ellipse>
                <ellipse transform="rotate(-90 12 12)" cx="12" cy="4" rx="2" ry="2">
                    <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="4; 2; 2; 2; 2; 4" />
                </ellipse>
                <ellipse transform="rotate(-45 12 12)" cx="12" cy="4" rx="2" ry="2">
                    <animate attributeName="ry" dur="3s" repeatCount="indefinite" values="4; 2; 2; 2; 2; 4" />
                </ellipse>
            </g>
        </svg>
    );
}

function ComplementingArcs(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <circle cx="12" cy="12" r="10.5" strokeDasharray="10 66">
                    <animate attributeName="stroke-dasharray" dur="3s" repeatCount="indefinite" values="10 66; 46 66; 10 66" />
                </circle>
                <g transform="rotate(142 12 12)">
                    <circle transform="matrix(-1, 0, 0, 1, 24, 0)" cx="12" cy="12" r="10.5" strokeDasharray="42 66">
                        <animate attributeName="stroke-dasharray" dur="3s" repeatCount="indefinite" values="42 66; 6 66; 42 66" />
                    </circle>
                </g>
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function PulsatingCapsules(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="360 12 12; 0 12 12" />
                <g>
                    <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12; 45 12 12; 90 12 12; 135 12 12; 180 12 12; 225 12 12; 270 12 12; 315 12 12" />
                    <line x1="12" x2="12" y1="2" y2="2">
                        <animate attributeName="y1" dur="2s" repeatCount="indefinite" values="2; 5; 2" />
                    </line>
                    <line opacity="0.3" transform="rotate(45 12 12)" x1="12" x2="12" y1="2" y2="2">
                        <animate attributeName="y1" dur="2s" repeatCount="indefinite" values="2; 5; 2" />
                    </line>
                    <line opacity="0.4" transform="rotate(90 12 12)" x1="12" x2="12" y1="2" y2="2">
                        <animate attributeName="y1" dur="2s" repeatCount="indefinite" values="2; 5; 2" />
                    </line>
                    <line opacity="0.5" transform="rotate(135 12 12)" x1="12" x2="12" y1="2" y2="2">
                        <animate attributeName="y1" dur="2s" repeatCount="indefinite" values="2; 5; 2" />
                    </line>
                    <line opacity="0.6" transform="rotate(180 12 12)" x1="12" x2="12" y1="2" y2="2">
                        <animate attributeName="y1" dur="2s" repeatCount="indefinite" values="2; 5; 2" />
                    </line>
                    <line opacity="0.7" transform="rotate(-135 12 12)" x1="12" x2="12" y1="2" y2="2">
                        <animate attributeName="y1" dur="2s" repeatCount="indefinite" values="2; 5; 2" />
                    </line>
                    <line opacity="0.8" transform="rotate(-90 12 12)" x1="12" x2="12" y1="2" y2="2">
                        <animate attributeName="y1" dur="2s" repeatCount="indefinite" values="2; 5; 2" />
                    </line>
                    <line opacity="0.9" transform="rotate(-45 12 12)" x1="12" x2="12" y1="2" y2="2">
                        <animate attributeName="y1" dur="2s" repeatCount="indefinite" values="2; 5; 2" />
                    </line>
                </g>
            </g>
        </svg>
    );
}

function DynamicArc(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="10.5" strokeDasharray="66 66" strokeDashoffset="20">
                <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite" values="20; 66; 20" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="-90 12 12;270 12 12" />
            </circle>
        </svg>
    );
}

function StaticArc(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle opacity="0.25" cx="12" cy="12" r="10.5" />
            <path strokeLinecap="round" d="M4.5754 4.5754c4.1005-4.1005 10.7487-4.1005 14.8492 0">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </path>
        </svg>
    );
}

function Lights(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeLinecap="round" strokeLinejoin="round" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <radialGradient id="lights_gradient0">
                    <stop offset="50%">
                        <animate attributeName="offset" dur="2s" repeatCount="indefinite" values="0.2; 0.7; 0.2" />
                    </stop>
                    <stop offset="50%" stopColor="currentColor">
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
    );
}

function DualResizingArcs(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" strokeDasharray="66 66" strokeDashoffset="50" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle opacity="0.3" cx="12" cy="12" r="10.5" strokeDashoffset="0" />
            <circle cx="12" cy="12" r="10.5">
                <animate attributeName="stroke-dashoffset" dur="2s" keyTimes="0; 0.3; 0.8; 1" repeatCount="indefinite" values="50; 60; 66; 50" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="-90 12 12;270 12 12" />
            </circle>
            <circle transform="rotate(180 12 12)" cx="12" cy="12" r="10.5">
                <animate attributeName="stroke-dashoffset" dur="2s" keyTimes="0; 0.3; 0.8; 1" repeatCount="indefinite" values="50; 60; 66; 50" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="90 12 12;450 12 12" />
            </circle>
        </svg>
    );
}

function Stubborn(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="10.5" strokeDasharray="66 8" strokeDashoffset="40">
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <animate attributeName="stroke-dashoffset" dur="1.25s" repeatCount="indefinite" values="40; 10; 40" />
            </circle>
        </svg>
    );
}

function DualFadingRing(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs stroke="currentColor">
                <linearGradient id="dual_fading_ring_gradient1" gradientTransform="matrix(0.919239, 0.919239, -0.707107, 0.707107, 0.04038, 0.04038)">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="50%" stopColor="currentColor" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
            </defs>
            <circle strokeWidth="3" stroke="url(#dual_fading_ring_gradient1)" cx="12" cy="12" r="10.5">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
            </circle>
        </svg>
    );
}

function DelayedDynamicArcOnCircle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle opacity="0.3" cx="12" cy="12" r="10.5" />
            <circle strokeLinecap="round" cx="12" cy="12" r="10.5" strokeDasharray="66 66" strokeDashoffset="20">
                <animate attributeName="stroke-dashoffset" dur="5s" repeatCount="indefinite" values="10; 60; 60; 60; 60; 10" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="-90 12 12;270 12 12" />
            </circle>
        </svg>
    );
}

function DelayedDynamicArc(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" cx="12" cy="12" r="10.5" strokeDasharray="66 66" strokeDashoffset="20">
                <animate attributeName="stroke-dashoffset" dur="5s" repeatCount="indefinite" values="10; 60; 60; 60; 60; 10" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="-90 12 12;270 12 12" />
            </circle>
        </svg>
    );
}

function AcceleratingDualArcs(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle strokeWidth="3" cx="12" cy="12" r="10.5" strokeDasharray="16.493361">
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12; 900 12 12; 1350 12 12; 1800 12 12" />
            </circle>
            <circle opacity="0.5" cx="12" cy="12" r="5">
                <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="0.3; 1; 0.3" />
            </circle>
        </svg>
    );
}

function Hole(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="10.5" strokeDasharray="66" strokeDashoffset="8">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="-90 12 12;270 12 12" />
            </circle>
        </svg>
    );
}

function DynamicArcOnCircle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle opacity="0.3" cx="12" cy="12" r="10.5" />
            <circle cx="12" cy="12" r="10.5" strokeDasharray="66 66" strokeDashoffset="20">
                <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite" values="20; 66; 20" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="-90 12 12;270 12 12" />
            </circle>
        </svg>
    );
}

function QuadChase(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <path transform="rotate(22.5 12 12)" d="M19.4246 19.4246C17.5245 21.3247 14.8995 22.5 12 22.5" />
                <path transform="rotate(22.5 12 12)" d="M19.4246 4.5754C21.3247 6.4755 22.5 9.1005 22.5 12" />
                <path transform="rotate(22.5 12 12)" d="M4.5754 4.5754C6.4755 2.6753 9.1005 1.5 12 1.5" />
                <path transform="rotate(22.5 12 12)" d="M4.5754 19.4246C2.6753 17.5245 1.5 14.8995 1.5 12" />
                <animate attributeName="stroke-dasharray" dur="1.5s" repeatCount="indefinite" values="0 8.24668; 8.24668 8.24668; 8.24668 8.24668; 8.24668 8.24668; 0 8.24668" />
                <animate attributeName="stroke-dashoffset" dur="1.5s" repeatCount="indefinite" values="-4.12334; 0; 0; 0; -4.12334" />
                <animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12; 240 12 12; 360 12 12" />
            </g>
        </svg>
    );
}

function TripleTails(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12; 240 12 12; 120 12 12; 360 12 12" />
                <g>
                    <circle cx="12" cy="3" r="3" />
                    <path opacity="0.6" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" d="M3 12c0-4.9706 4.0294-9 9-9" strokeDasharray="14.137167 14.137167" strokeDashoffset="-2">
                        <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite" values="-2; -14; -2" />
                    </path>
                </g>
                <g transform="rotate(120 12 12)">
                    <circle cx="12" cy="3" r="3" />
                    <path opacity="0.6" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" d="M3 12c0-4.9706 4.0294-9 9-9" strokeDasharray="14.137167 14.137167" strokeDashoffset="-2">
                        <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite" values="-2; -14; -2" />
                    </path>
                </g>
                <g transform="rotate(-120 12 12)">
                    <circle cx="12" cy="3" r="3" />
                    <path opacity="0.6" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" d="M3 12c0-4.9706 4.0294-9 9-9" strokeDasharray="14.137167 14.137167" strokeDashoffset="-2">
                        <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite" values="-2; -14; -2" />
                    </path>
                </g>
            </g>
        </svg>
    );
}

function Opposites(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" strokeDasharray="66 66" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g strokeWidth="2" stroke="none" strokeLinejoin="round" fill="currentColor">
                <circle opacity="0.3" strokeWidth="3" stroke="currentColor" fill="none" cx="12" cy="12" r="8.5" />
                <circle cx="12" cy="3.5" r="1.5">
                    <animate attributeName="r" dur="2s" repeatCount="indefinite" values="3.5; 1.5; 3.5; 1.5; 3.5" />
                </circle>
                <circle cx="12" cy="20.5" r="1.5">
                    <animate attributeName="r" dur="1s" repeatCount="indefinite" values="1.5; 3.5; 1.5" />
                </circle>
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function Worm(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <polyline strokeLinecap="round">
                    <animate attributeName="points" dur="3s" repeatCount="indefinite" values="12 1.5 12 1.5; 12 1.5 22.5 12; 22.5 12 22.5 12; 22.5 12 12 22.5; 12 22.5 12 22.5; 12 22.5 1.5 12; 1.5 12 1.5 12; 1.5 12 12 1.5; 12 1.5 12 1.5" />
                </polyline>
                <polygon opacity="0.4" points="1.5 12 12 1.5 22.5 12 12 22.5" />
                <animateTransform attributeName="transform" dur="5s" repeatCount="indefinite" type="rotate" values="360 12 12;0 12 12" />
            </g>
        </svg>
    );
}

function CircularArrow(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g strokeLinecap="round">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                <path strokeWidth="2" stroke="currentColor" fill="none" d="M20 12c0 4.4183-3.5817 8-8 8s-8-3.5817-8-8c0-4.7473 4.1351-8.5289 9-7.9393" />
                <polygon points="12 0 12 8 17 4" />
            </g>
        </svg>
    );
}

function DualCircularArrows(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g strokeWidth="1" fill="currentColor">
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                <path strokeWidth="2" stroke="currentColor" fill="none" d="M18.1247 6.5C22.9634 13.3459 17.667 20.7473 11 19.9393" />
                <polygon points="12 24 12 16 7 20" />
                <path strokeWidth="2" stroke="currentColor" fill="none" d="M5.8753 17.5C1.0366 10.6541 6.333 3.2527 13 4.0607" />
                <polygon points="12 0 12 8 17 4" />
            </g>
        </svg>
    );
}

function PausingCircularArrows(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g fill="currentColor">
                <animateTransform attributeName="transform" dur="2.5s" repeatCount="indefinite" type="rotate" values="0 12 12; 180 12 12; 180 12 12; 360 12 12; 360 12 12" />
                <path stroke="currentColor" fill="none" d="M17.5 18.1247C10.6541 22.9634 3.2527 17.667 4.0607 11" />
                <polygon points="0 12 8 12 4 7" />
                <path stroke="currentColor" fill="none" d="M6.5 5.8753C13.3459 1.0366 20.7473 6.333 19.9393 13" />
                <polygon points="24 12 16 12 20 17" />
            </g>
        </svg>
    );
}

function Spirals(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <path transform="rotate(120 12.019632 12.025527)" className="st0" d="M12.0073 12.0553c0.9587 0 1.6839-1.1922 1.0202-2.4705-0.6514-1.2783-2.6057-2.2124-4.8181-1.3151-2.1878 0.8849-4.0314 3.4783-3.6381 6.8706 0.3933 3.3555 3.0727 6.7109 7.4237 7.645" />
                <path transform="rotate(-120 11.987709 12.029765)" className="st0" d="M12.0073 12.0553c0.9587 0 1.6839-1.1922 1.0202-2.4705-0.6514-1.2783-2.6057-2.2124-4.8181-1.3151-2.1878 0.8849-4.0314 3.4783-3.6381 6.8706 0.3933 3.3555 3.0727 6.7109 7.4237 7.645" />
                <path transform="translate(-7341e-6 -0.055292)" className="st0" d="M12.0073 12.0553c0.9587 0 1.6839-1.1922 1.0202-2.4705-0.6514-1.2783-2.6057-2.2124-4.8181-1.3151-2.1878 0.8849-4.0314 3.4783-3.6381 6.8706 0.3933 3.3555 3.0727 6.7109 7.4237 7.645" />
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function ArcAroundPulse(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <path strokeLinecap="round" d="M4.5754 4.5754c4.1005-4.1005 10.7487-4.1005 14.8492 0">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </path>
            <circle stroke="none" fill="currentColor" cx="12" cy="12" r="3">
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="3; 9" />
                <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="0; 0.5; 0" />
            </circle>
        </svg>
    );
}

function Spiral(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="1.5" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <radialGradient id="spiral_gradient0">
                    <stop offset="65%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0.5" />
                </radialGradient>
            </defs>
            <g>
                <path strokeLinecap="round" d="M19 3.2498c-2.0074-1.4301-4.4658-2.1798-7-2.0341-2.7612 0.1587-5.3997 1.385-7.2791 3.5052C2.9708 6.6955 2.0256 9.3045 2.1961 12c0.1595 2.5218 1.2962 4.904 3.2181 6.5858 1.7951 1.5708 4.1564 2.4086 6.5858 2.2377 2.2519-0.1584 4.3889-1.1853 5.8926-2.931 1.3882-1.6117 2.1222-3.7243 1.9505-5.8925-0.1585-2.0031-1.0896-3.8873-2.6438-5.1993C15.7654 5.5902 13.8997 4.9653 12 5.1373 10.2566 5.2951 8.621 6.1232 7.4939 7.4939 6.4613 8.7497 5.9452 10.3686 6.1177 12c0.1572 1.488 0.8854 2.8736 2.0695 3.8128 1.0763 0.8537 2.4479 1.2624 3.8128 1.0892 1.2367-0.157 2.3708-0.7877 3.1196-1.7824 0.6817-0.9056 0.9746-2.0319 0.802-3.1196-0.1588-1.0005-0.7015-1.8764-1.4952-2.4264C13.7013 9.0713 12.8223 8.8847 12 9.0588c-0.7442 0.1576-1.3712 0.5994-1.7331 1.2081C9.9426 10.8124 9.8627 11.4445 10.0392 12c0.1577 0.4961 0.5034 0.8709 0.9209 1.0399 0.3722 0.1505 0.7597 0.1186 1.0399-0.0595 0.2517-0.16 0.3731-0.412 0.3466-0.6338C12.3218 12.1386 12.1709 12 12 12" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function PulsingSwirl(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <linearGradient id="pulsing_swirl_one_gradient0" gradientTransform="rotate(-70 0.857037 0.25)">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="80%" stopColor="currentColor">
                        <animate attributeName="offset" dur="2s" repeatCount="indefinite" values="0.5; 1; 0.5" />
                    </stop>
                </linearGradient>
            </defs>
            <g fill="url(#pulsing_swirl_one_gradient0)">
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                <path d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(60 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(120 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(180 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(-120 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(-60 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
            </g>
        </svg>
    );
}

function Swirl(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <linearGradient id="swirl_one_gradient0" gradientTransform="rotate(-70 0.857037 0.25)">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="80%" stopColor="currentColor" />
                </linearGradient>
            </defs>
            <g fill="url(#swirl_one_gradient0)">
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                <path d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(60 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(120 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(180 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(-120 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
                <path transform="rotate(-60 12 12)" d="M11.7252 23.9704c-2.3357-0.292-4.394-2.4962-4.6714-5.5472-0.2919-3.2116 2.0915-5.5474 4.6714-5.5474 0.3188 0 0.6376 0 0.8941-0.2565 0.1642-0.1642 0.2565-0.387 0.2565-0.6193s-0.0923-0.4551-0.2565-0.6193c-0.2565-0.2565-0.5753-0.2565-0.8941-0.2565-3.5473 0-6.4231 2.8757-6.4231 6.423 0 3.5475 2.8758 6.4232 6.4231 6.4232" />
            </g>
        </svg>
    );
}

function Fireball(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                <path d="M10 0c13 6-4 15 4 24-13-6 4-15-4-24z" />
                <path d="M19.0711 2.1005c4.9497 13.435-13.4351 7.7782-14.1422 19.799-4.9497-13.435 13.4351-7.7782 14.1422-19.799z" />
                <path d="M24 10C18 23 9 6 0 14c6-13 15 4 24-4z" />
                <path d="M21.8995 19.0711C8.4645 24.0208 14.1213 5.636 2.1005 4.9289c13.435-4.9497 7.7782 13.4351 19.799 14.1422z" />
            </g>
        </svg>
    );
}

function Wormhole(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <radialGradient id="wormhole_gradient0">
                    <stop offset="20%" />
                    <stop offset="50%" stopColor="currentColor">
                        <animate attributeName="offset" dur="3s" repeatCount="indefinite" values="0.4; 1.5; 0.4" />
                    </stop>
                </radialGradient>
                <mask id="wormhole_m" color="#000">
                    <rect fill="url(#wormhole_gradient0)" width="28" height="28" x="-2" y="-2" />
                </mask>
            </defs>
            <g mask="url(#wormhole_m)">
                <path transform="rotate(120 12.019632 12.025527)" className="st0" d="M12.0073 12.0553c0.9587 0 1.6839-1.1922 1.0202-2.4705-0.6514-1.2783-2.6057-2.2124-4.8181-1.3151-2.1878 0.8849-4.0314 3.4783-3.6381 6.8706 0.3933 3.3555 3.0727 6.7109 7.4237 7.645" />
                <path transform="rotate(-120 11.987709 12.029765)" className="st0" d="M12.0073 12.0553c0.9587 0 1.6839-1.1922 1.0202-2.4705-0.6514-1.2783-2.6057-2.2124-4.8181-1.3151-2.1878 0.8849-4.0314 3.4783-3.6381 6.8706 0.3933 3.3555 3.0727 6.7109 7.4237 7.645" />
                <path transform="translate(-7341e-6 -0.055292)" className="st0" d="M12.0073 12.0553c0.9587 0 1.6839-1.1922 1.0202-2.4705-0.6514-1.2783-2.6057-2.2124-4.8181-1.3151-2.1878 0.8849-4.0314 3.4783-3.6381 6.8706 0.3933 3.3555 3.0727 6.7109 7.4237 7.645" />
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function FadingSpirals(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <radialGradient id="fading_spirals_gradient1">
                    <stop offset="39%" stopColor="currentColor" />
                    <stop offset="83%" stopColor="currentColor" stopOpacity="0" />
                </radialGradient>
                <mask id="fading_spirals_m" color="#000">
                    <rect stroke="none" fill="url(#fading_spirals_gradient1)" width="100%" height="100%" x="0" y="0" />
                </mask>
            </defs>
            <g mask="url(#fading_spirals_m)">
                <path className="st0" d="M11.9407 11.7587c-0.5898 1.0215 0.2344 2.5276 2.0047 2.6068 1.7627 0.0923 3.9603-1.4154 4.3652-4.3247 0.403-2.8754-1.2262-6.4352-5.0826-8.103C9.4107 0.2927 4.1873 1.0835 0.5154 5.1449" />
                <path className="st0" d="M11.9407 11.7588c-0.5898-1.0215-2.3062-1.0608-3.2599 0.4328-0.9614 1.4804-0.7544 4.1373 1.5627 5.9427 2.2887 1.7867 6.1861 2.1557 9.5587-0.3502 3.3333-2.4833 5.2602-7.4023 3.5789-12.6129" />
                <path className="st0" d="M11.9406 11.7588c1.1795 0 2.0718-1.4668 1.2552-3.0396-0.8015-1.5727-3.2059-2.722-5.9279-1.618-2.6917 1.0887-4.96 4.2795-4.4761 8.4532 0.4839 4.1284 3.7805 8.2567 9.1337 9.4059" />
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function FadingArrows(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12; 45 12 12; 90 12 12; 135 12 12; 180 12 12; 225 12 12; 270 12 12; 315 12 12" />
                <polyline opacity="0.875" points="3 6 7 6 7 10" />
                <polyline transform="rotate(45 12 12)" points="3 6 7 6 7 10" />
                <polyline opacity="0.125" transform="rotate(135 12 12)" points="3 6 7 6 7 10" />
                <polyline opacity="0.25" transform="rotate(180 12 12)" points="3 6 7 6 7 10" />
                <polyline opacity="0.5" transform="rotate(-135 12 12)" points="3 6 7 6 7 10" />
                <polyline opacity="0.625" transform="rotate(-90 12 12)" points="3 6 7 6 7 10" />
                <polyline opacity="0.75" transform="rotate(-45 12 12)" points="3 6 7 6 7 10" />
            </g>
        </svg>
    );
}

function FadingTriangles(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12; 45 12 12; 90 12 12; 135 12 12; 180 12 12; 225 12 12; 270 12 12; 315 12 12" />
                <polygon points="10 0 16 3.5 10 7" />
                <polygon opacity="0.125" transform="rotate(90 12 12)" points="10 0 16 3.5 10 7" />
                <polygon opacity="0.25" transform="rotate(135 12 12)" points="10 0 16 3.5 10 7" />
                <polygon opacity="0.5" transform="rotate(180 12 12)" points="10 0 16 3.5 10 7" />
                <polygon opacity="0.625" transform="rotate(-135 12 12)" points="10 0 16 3.5 10 7" />
                <polygon opacity="0.75" transform="rotate(-90 12 12)" points="10 0 16 3.5 10 7" />
                <polygon opacity="0.875" transform="rotate(-45 12 12)" points="10 0 16 3.5 10 7" />
            </g>
        </svg>
    );
}

function GradualFadedBump(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="3" r="3">
                <animate id="gradual_faded_bump_a0" attributeName="r" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
                <animate attributeName="opacity" dur="0.8s" repeatCount="indefinite" values="0.4; 0.4; 1; 0.4; 0.4" />
            </circle>
            <circle opacity="0.7" transform="rotate(45 12 12)" cx="12" cy="3" r="2.5">
                <animate id="gradual_faded_bump_a1" attributeName="r" begin="gradual_faded_bump_a0.begin+0.1s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
                <animate attributeName="opacity" begin="gradual_faded_bump_a0.begin+0.1s" dur="0.8s" repeatCount="indefinite" values="0.4; 0.4; 1; 0.4; 0.4" />
            </circle>
            <circle opacity="0.4" transform="rotate(90 12 12)" cx="12" cy="3" r="2">
                <animate id="gradual_faded_bump_a2" attributeName="r" begin="gradual_faded_bump_a0.begin+0.2s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
                <animate attributeName="opacity" begin="gradual_faded_bump_a0.begin+0.2s" dur="0.8s" repeatCount="indefinite" values="0.4; 0.4; 1; 0.4; 0.4" />
            </circle>
            <circle opacity="0.4" transform="rotate(135 12 12)" cx="12" cy="3" r="2">
                <animate id="gradual_faded_bump_a3" attributeName="r" begin="gradual_faded_bump_a0.begin+0.3s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
                <animate attributeName="opacity" begin="gradual_faded_bump_a0.begin+0.3s" dur="0.8s" repeatCount="indefinite" values="0.4; 0.4; 1; 0.4; 0.4" />
            </circle>
            <circle opacity="0.4" transform="rotate(180 12 12)" cx="12" cy="3" r="2">
                <animate id="gradual_faded_bump_a4" attributeName="r" begin="gradual_faded_bump_a0.begin+0.4s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
                <animate attributeName="opacity" begin="gradual_faded_bump_a0.begin+0.4s" dur="0.8s" repeatCount="indefinite" values="0.4; 0.4; 1; 0.4; 0.4" />
            </circle>
            <circle opacity="0.4" transform="rotate(-135 12 12)" cx="12" cy="3" r="2">
                <animate id="gradual_faded_bump_a5" attributeName="r" begin="gradual_faded_bump_a0.begin+0.5s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
                <animate attributeName="opacity" begin="gradual_faded_bump_a0.begin+0.5s" dur="0.8s" repeatCount="indefinite" values="0.4; 0.4; 1; 0.4; 0.4" />
            </circle>
            <circle opacity="0.4" transform="rotate(-90 12 12)" cx="12" cy="3" r="2">
                <animate id="gradual_faded_bump_a6" attributeName="r" begin="gradual_faded_bump_a0.begin+0.6s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
                <animate attributeName="opacity" begin="gradual_faded_bump_a0.begin+0.6s" dur="0.8s" repeatCount="indefinite" values="0.4; 0.4; 1; 0.4; 0.4" />
            </circle>
            <circle opacity="0.7" transform="rotate(-45 12 12)" cx="12" cy="3" r="2.5">
                <animate id="gradual_faded_bump_a7" attributeName="r" begin="gradual_faded_bump_a0.begin+0.7s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
                <animate attributeName="opacity" begin="gradual_faded_bump_a0.begin+0.7s" dur="0.8s" repeatCount="indefinite" values="0.4; 0.4; 1; 0.4; 0.4" />
            </circle>
        </svg>
    );
}

function GradualBump(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="3" r="3">
                <animate id="gradual_bump_a0" attributeName="r" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
            </circle>
            <circle cx="18.364" cy="5.63604" r="2.5">
                <animate attributeName="r" begin="gradual_bump_a0.begin+0.1s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
            </circle>
            <circle cx="21" cy="12" r="2">
                <animate attributeName="r" begin="gradual_bump_a0.begin+0.2s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
            </circle>
            <circle cx="18.364" cy="18.364" r="2">
                <animate attributeName="r" begin="gradual_bump_a0.begin+0.3s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
            </circle>
            <circle cx="12" cy="21" r="2">
                <animate attributeName="r" begin="gradual_bump_a0.begin+0.4s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
            </circle>
            <circle cx="5.63604" cy="18.364" r="2">
                <animate attributeName="r" begin="gradual_bump_a0.begin+0.5s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
            </circle>
            <circle cx="3" cy="12" r="2">
                <animate attributeName="r" begin="gradual_bump_a0.begin+0.6s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
            </circle>
            <circle cx="5.63604" cy="5.63604" r="2.5">
                <animate attributeName="r" begin="gradual_bump_a0.begin+0.7s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
            </circle>
        </svg>
    );
}

function LargeRotatingSingleton(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12; 45 12 12; 90 12 12; 135 12 12; 180 12 12; 225 12 12; 270 12 12; 315 12 12" />
                <circle cx="12" cy="3" r="3" />
                <circle opacity="0.5" cx="18.364" cy="5.63604" r="2" />
                <circle opacity="0.5" cx="21" cy="12" r="2" />
                <circle opacity="0.5" cx="18.364" cy="18.364" r="2" />
                <circle opacity="0.5" cx="12" cy="21" r="2" />
                <circle opacity="0.5" cx="5.63604" cy="18.364" r="2" />
                <circle opacity="0.5" cx="3" cy="12" r="2" />
                <circle opacity="0.5" cx="5.63604" cy="5.63604" r="2" />
            </g>
        </svg>
    );
}

function Lazy(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <circle cx="12" cy="2.5" r="2.5" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
            <circle opacity="0.25" strokeWidth="3" stroke="currentColor" fill="none" cx="12" cy="12" r="9.5" />
            <g>
                <circle cx="12" cy="2.5" r="2.5" />
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.5; 1" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12; 360 12 12" />
            </g>
        </svg>
    );
}

function Ring(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <path opacity="0.25" d="M15.3619 1.5232C15.4518 1.8332 15.5 2.161 15.5 2.5c0 0.7544-0.2387 1.4531-0.6447 2.0246C17.8636 5.6743 20 8.5877 20 12c0 4.4183-3.5817 8-8 8s-8-3.5817-8-8c0-3.4123 2.1364-6.3257 5.1447-7.4754C8.7387 3.9531 8.5 3.2544 8.5 2.5c0-0.339 0.0482-0.6668 0.1381-0.9768C4.2073 2.9439 1 7.0974 1 12c0 6.0751 4.9249 11 11 11s11-4.9249 11-11c0-4.9026-3.2073-9.0561-7.6381-10.4768z" />
                <circle cx="12" cy="2.5" r="2.5" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
            <g />
        </svg>
    );
}

function FadingMeteor(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <linearGradient id="fading_meteor_one_gradient0" gradientTransform="rotate(-70 0.857037 0.25)">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="100%" stopColor="currentColor" />
                </linearGradient>
            </defs>
            <path fill="url(#fading_meteor_one_gradient0)" d="M12 23c-4-0.5-7.525-4.2748-8-9.5C3.5 8 7.5817 4 12 4c0.5459 0 1.0919 0 1.5312-0.4393 0.2813-0.2813 0.4394-0.6629 0.4394-1.0607s-0.1581-0.7794-0.4394-1.0607C13.0919 1 12.5459 1 12 1 5.9249 1 1 5.9249 1 12s4.9249 11 11 11">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </path>
        </svg>
    );
}

function DualFadingTails(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs fill="currentColor">
                <linearGradient id="dual_fading_tails_one_gradient1" gradientTransform="rotate(-70 0.857037 0.25)">
                    <stop offset="10%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="100%" stopColor="currentColor" />
                </linearGradient>
            </defs>
            <g fill="url(#dual_fading_tails_one_gradient1)">
                <path d="M12 23c-4-0.5-7.525-4.2748-8-9.5C3.5 8 7.5817 4 12 4c0.5459 0 1.0919 0 1.5312-0.4393 0.2813-0.2813 0.4394-0.6629 0.4394-1.0607s-0.1581-0.7794-0.4394-1.0607C13.0919 1 12.5459 1 12 1 5.9249 1 1 5.9249 1 12s4.9249 11 11 11" />
                <path transform="rotate(180 12 12)" d="M12 23c-4-0.5-7.525-4.2748-8-9.5C3.5 8 7.5817 4 12 4c0.5459 0 1.0919 0 1.5312-0.4393 0.2813-0.2813 0.4394-0.6629 0.4394-1.0607s-0.1581-0.7794-0.4394-1.0607C13.0919 1 12.5459 1 12 1 5.9249 1 1 5.9249 1 12s4.9249 11 11 11" />
                <animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function ShadowedGauge(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs strokeLinecap="butt" strokeLinejoin="miter" fill="currentColor">
                <linearGradient id="shadowed_gauge_gradient2">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="50%" stopColor="currentColor" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="shadowed_gauge_gradient1" gradientTransform="matrix(0.5, 0, 0, 1, 0.25, 0.1)">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="49%" stopColor="currentColor" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
            </defs>
            <g>
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;30 12 12; 60 12 12; 90 12 12; 120 12 12; 150 12 12; 180 12 12; 210 12 12; 240 12 12; 270 12 12; 300 12 12; 330 12 12;" />
                <g stroke="url(#shadowed_gauge_gradient1)">
                    <line strokeWidth="2" stroke="currentColor" x1="12" x2="12.00005" y1="1" y2="4" />
                    <path strokeWidth="5" stroke="url(#shadowed_gauge_gradient2)" strokeLinecap="butt" strokeLinejoin="miter" d="M2.5001 12c0-5.2467 4.2532-9.5 9.4999-9.5s9.5 4.2533 9.5 9.5" />
                </g>
                <g strokeWidth="2" stroke="currentColor">
                    <path opacity="0.6" d="M17.5 2.4737 16 5.0718" />
                    <path opacity="0.6" d="M6.5 2.4737 8 5.0718" />
                    <path opacity="0.4" d="M12 1v3" />
                    <path opacity="0.4" d="M1 12h3M12 23v-3M23 12h-3M2.4738 6.5 5.0718 8M2.4738 17.5 5.0718 16M6.5 21.5263 8 18.9282M17.5 21.5263 16 18.9282M21.5263 17.5 18.9282 16M21.5263 6.5 18.9282 8" />
                </g>
            </g>
        </svg>
    );
}

function Dance(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <line x1="12" x2="12" y1="1" y2="5" />
                <line opacity="0.8" transform="rotate(30 12 12)" x1="12" x2="12" y1="2" y2="5" />
                <line opacity="0.8" transform="rotate(-30 12 12)" x1="12" x2="12" y1="2" y2="5" />
                <line opacity="0.6" transform="rotate(60 12 12)" x1="12" x2="12" y1="3" y2="5" />
                <line opacity="0.6" transform="rotate(-60 12 12)" x1="12" x2="12" y1="3" y2="5" />
                <line opacity="0.4" transform="rotate(90 12 12)" x1="12" x2="12" y1="3" y2="5" />
                <line opacity="0.4" transform="rotate(-90 12 12)" x1="12" x2="12" y1="3" y2="5" />
                <line opacity="0.4" transform="rotate(120 12 12)" x1="12" x2="12" y1="3" y2="5" />
                <line opacity="0.4" transform="rotate(-120 12 12)" x1="12" x2="12" y1="3" y2="5" />
                <line opacity="0.4" transform="rotate(150 12 12)" x1="12" x2="12" y1="3" y2="5" />
                <line opacity="0.4" transform="rotate(-150 12 12)" x1="12" x2="12" y1="3" y2="5" />
                <line opacity="0.4" transform="rotate(180 12 12)" x1="12" x2="12" y1="3" y2="5" />
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;30 12 12; 60 12 12; 90 12 12; 120 12 12; 150 12 12; 180 12 12; 210 12 12; 240 12 12; 270 12 12; 300 12 12; 330 12 12;" />
            </g>
        </svg>
    );
}

function FadingSticks(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g strokeLinecap="round" strokeLinejoin="round">
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;30 12 12; 60 12 12; 90 12 12; 120 12 12; 150 12 12; 180 12 12; 210 12 12; 240 12 12; 270 12 12; 300 12 12; 330 12 12;" />
                <path d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.1" transform="rotate(90 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.2" transform="rotate(120 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.3" transform="rotate(150 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.4" transform="rotate(180 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.5" transform="rotate(-150 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.6" transform="rotate(-120 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.7" transform="rotate(-90 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.8" transform="rotate(-60 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
                <path opacity="0.9" transform="rotate(-30 12 12)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137v3.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 6a1 1 0.7854 0 1-0.7071-0.2929C11 5.4142 11 5.0503 11 4.6863V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z" />
            </g>
        </svg>
    );
}

function FadingSlants(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g strokeWidth="2" stroke="currentColor" strokeLinecap="round" fill="none">
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;30 12 12; 60 12 12; 90 12 12; 120 12 12; 150 12 12; 180 12 12; 210 12 12; 240 12 12; 270 12 12; 300 12 12; 330 12 12;" />
                <line x1="10" x2="13" y1="1" y2="5" />
                <line opacity="0.9" transform="rotate(-30 12 12)" x1="10" x2="13" y1="1" y2="5" />
                <line opacity="0.8" transform="rotate(-60 12 12)" x1="10" x2="13" y1="1" y2="5" />
                <line opacity="0.7" transform="rotate(-90 12 12)" x1="10" x2="13" y1="1" y2="5" />
                <line opacity="0.6" transform="rotate(-120 12 12)" x1="10" x2="13" y1="1" y2="5" />
                <line opacity="0.5" transform="rotate(-150 12 12)" x1="10" x2="13" y1="1" y2="5" />
                <line opacity="0.4" transform="rotate(-180 12 12)" x1="10" x2="13" y1="1" y2="5" />
                <line opacity="0.3" transform="rotate(150 12 12)" x1="10" x2="13" y1="1" y2="5" />
                <line opacity="0.2" transform="rotate(120 12 12)" x1="10" x2="13" y1="1" y2="5" />
                <line opacity="0.1" transform="rotate(90 12 12)" x1="10" x2="13" y1="1" y2="5" />
                <line transform="rotate(30 12 12)" x1="10" x2="13" y1="1" y2="5" />
            </g>
        </svg>
    );
}

function FadingCircles(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g fill="currentColor">
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;30 12 12; 60 12 12; 90 12 12; 120 12 12; 150 12 12; 180 12 12; 210 12 12; 240 12 12; 270 12 12; 300 12 12; 330 12 12;" />
                <circle cx="12" cy="2" r="2" />
                <circle opacity="0.1" transform="rotate(120 12 12)" cx="12" cy="2" r="2" />
                <circle opacity="0.2" transform="rotate(150 12 12)" cx="12" cy="2" r="2" />
                <circle opacity="0.3" transform="rotate(180 12 12)" cx="12" cy="2" r="2" />
                <circle opacity="0.4" transform="rotate(-150 12 12)" cx="12" cy="2" r="2" />
                <circle opacity="0.5" transform="rotate(-120 12 12)" cx="12" cy="2" r="2" />
                <circle opacity="0.6" transform="rotate(-90 12 12)" cx="12" cy="2" r="2" />
                <circle opacity="0.8" transform="rotate(-60 12 12)" cx="12" cy="2" r="2" />
                <circle opacity="0.9" transform="rotate(-30 12 12)" cx="12" cy="2" r="2" />
            </g>
        </svg>
    );
}

function FadingSlices(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;30 12 12; 60 12 12; 90 12 12; 120 12 12; 150 12 12; 180 12 12; 210 12 12; 240 12 12; 270 12 12; 300 12 12; 330 12 12;" />
                <path opacity="0.2" d="M21.8571 18.8457l-3.4829-2.0108c-0.4408 0.5803-0.959 1.0985-1.5393 1.5393l2.0108 3.4829c1.1737-0.8167 2.1947-1.8377 3.0114-3.0114z" />
                <path opacity="0.8" d="M5.1543 2.1429C3.9806 2.9596 2.9596 3.9806 2.1429 5.1543l3.4829 2.0108c0.4408-0.5803 0.959-1.0985 1.5393-1.5393z" />
                <path opacity="0.5" d="M5.6258 16.8349 2.1429 18.8457c0.8167 1.1737 1.8377 2.1947 3.0114 3.0114l2.0108-3.4829c-0.5803-0.4408-1.0985-0.959-1.5393-1.5393z" />
                <path opacity="0.6" d="M4.6243 15.1036C4.346 14.443 4.1538 13.737 4.0619 13H0.0411c0.1205 1.4614 0.503 2.8486 1.1003 4.1145z" />
                <path opacity="0.3" d="M17.1145 22.8586l-2.0109-3.4829C14.443 19.654 13.737 19.8462 13 19.9381v4.0208c1.4614-0.1205 2.8486-0.503 4.1145-1.1003z" />
                <path opacity="0.9" d="M11 4.0619V0.0411c-1.4614 0.1205-2.8486 0.503-4.1145 1.1003l2.0109 3.4829C9.557 4.346 10.263 4.1538 11 4.0619z" />
                <path d="M13 0.0411v4.0208c0.737 0.0919 1.443 0.2841 2.1036 0.5624l2.0109-3.4829C15.8486 0.5441 14.4614 0.1616 13 0.0411z" />
                <path opacity="0.4" d="M6.8855 22.8586C8.1514 23.4559 9.5386 23.8384 11 23.9589v-4.0208c-0.737-0.0919-1.443-0.2841-2.1036-0.5624z" />
                <path opacity="0.1" d="M19.9381 13c-0.0919 0.737-0.2841 1.443-0.5624 2.1036l3.4829 2.0109c0.5973-1.2659 0.9798-2.6531 1.1003-4.1145z" />
                <path opacity="0.7" d="M0.0411 11h4.0208c0.0919-0.737 0.2841-1.443 0.5624-2.1036L1.1414 6.8855C0.5441 8.1514 0.1616 9.5386 0.0411 11z" />
            </g>
        </svg>
    );
}

function RotatingPendulum(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                <circle strokeWidth="1" stroke="none" fill="currentColor" cx="12" cy="2" r="2">
                    <animateTransform attributeName="transform" dur="2s" keyTimes="0; 0; 0.45; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 0 12 12; 360 12 12; 360 12 12" />
                </circle>
                <circle strokeWidth="1" stroke="none" fill="currentColor" cx="12" cy="7" r="2">
                    <animateTransform attributeName="transform" dur="2s" keyTimes="0; 0.45; 0.9; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 0 12 12; 360 12 12; 360 12 12" />
                </circle>
                <circle opacity="0.4" cx="12" cy="12" r="10" />
                <circle opacity="0.4" cx="12" cy="12" r="5" />
            </g>
        </svg>
    );
}

function SmallRotatingSingleton(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeLinecap="round" strokeLinejoin="round" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <path opacity="0.4" d="M8 5.0718a2 2-15 1 1-2-3.4641 2 2-15 1 1 2 3.4641zM5.0718 8a2 2-30 1 1-3.4641-2 2 2-30 1 1 3.4641 2zM4 12c0 1.1046-0.8954 2-2 2s-2-0.8954-2-2 0.8954-2 2-2 2 0.8954 2 2zM5.0718 16a2 2-60 1 1-3.4641 2 2 2-60 1 1 3.4641-2zM8 18.9282a2 2-75 1 1-2 3.4641 2 2-75 1 1 2-3.4641zM12 20a2 2 90 1 1 0 4 2 2 90 1 1 0-4zM16 18.9282a2 2 75 1 1 2 3.4641 2 2 75 1 1-2-3.4641zM18.9282 16a2 2 60 1 1 3.4641 2 2 2 60 1 1-3.4641-2zM20 12c0-1.1046 0.8954-2 2-2s2 0.8954 2 2-0.8954 2-2 2-2-0.8954-2-2zM18.9282 8a2 2 30 1 1 3.4641-2 2 2 30 1 1-3.4641 2zM16 5.0718a2 2 15 1 1 2-3.4641 2 2 15 1 1-2 3.4641zM12 4a2 2 0 1 1 0-4 2 2 0 1 1 0 4z" />
            <circle cx="12" cy="2" r="2">
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12; 30 12 12; 60 12 12; 90 12 12; 120 12 12; 150 12 12; 180 12 12; 210 12 12;240 12 12; 270 12 12; 300 12 12; 330 12 12" />
            </circle>
        </svg>
    );
}

function ShortTick(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <path d="M7.7574 7.7574 9.1716 9.1716M6 12h2M7.7574 16.2426l1.4142-1.4142M12 18v-2M16.2426 16.2426l-1.4142-1.4142M18 12h-2M16.2426 7.7574 14.8284 9.1716M12 6v2">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.3; 0.3; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 45 12 12; 0 12 12; 0 12 12" />
            </path>
            <path opacity="0.6" d="M7.7905 1.8373 8.5558 3.6851M4.2218 4.2218 5.636 5.636M1.8373 7.7905 3.6851 8.5558M1 12h2M1.8373 16.2095l1.8478-0.7653M4.2218 19.7782 5.636 18.364M7.7905 22.1627l0.7653-1.8478M12 23v-2M16.2095 22.1627l-0.7653-1.8478M19.7782 19.7782 18.364 18.364M22.1627 16.2095l-1.8478-0.7653M23 12h-2M22.1627 7.7905 20.3149 8.5558M19.7782 4.2218 18.364 5.636M16.2095 1.8373 15.4442 3.6851M12 1v2">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.3; 0.3; 1" repeatCount="indefinite" type="rotate" values="0 12 12; -22.5 12 12; 0 12 12; 0 12 12" />
            </path>
        </svg>
    );
}

function LongTick(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <path d="M7 12h2M12 17v-2M17 12h-2M12 7v2">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.3; 0.3; 1" repeatCount="indefinite" type="rotate" values="0 12 12; 90 12 12; 0 12 12; 0 12 12" />
            </path>
            <path d="M4.2218 4.2218 5.636 5.636M1 12h2M4.2218 19.7782 5.636 18.364M12 23v-2M19.7782 19.7782 18.364 18.364M23 12h-2M19.7782 4.2218 18.364 5.636M12 1v2">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.3; 0.3; 1" repeatCount="indefinite" type="rotate" values="0 12 12; -45 12 12; 0 12 12; 0 12 12" />
            </path>
        </svg>
    );
}

function HexagonSquare(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <polygon points="23 12 17.5 2.473721 6.5 2.473721 1 12 6.5 21.526279 17.5 21.526279" transformOrigin="12 12">
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; -30; -30; -30; -60; -60; -60" />
            </polygon>
            <polygon points="17 12 12 7 7 12 12 17" transformOrigin="12 12">
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; 45; 45; 45; 90; 90; 90" />
            </polygon>
        </svg>
    );
}

function MorphingSquare(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <rect width="14" height="14" rx="7" x="5" y="5">
                <animate attributeName="rx" dur="1s" repeatCount="indefinite" values="0; 7; 0" />
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </rect>
        </svg>
    );
}

function MorphingSquares(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <rect width="14" height="14" x="5" y="5">
                <animate attributeName="rx" dur="1s" repeatCount="indefinite" values="0; 7; 0" />
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </rect>
            <rect width="6" height="6" x="9" y="9">
                <animate attributeName="rx" dur="2s" repeatCount="indefinite" values="7; 0; 7" />
                <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </rect>
        </svg>
    );
}

function Radar(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle opacity="0.5" fill="url(#radar_gradient1)" cx="12" cy="12" r="12" />
            <defs strokeWidth="1.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <linearGradient id="radar_gradient0" gradientTransform="rotate(122 0.361423 0.25)">
                    <stop offset="0%" stopColor="currentColor" />
                    <stop offset="81%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
                <radialGradient id="radar_gradient1" gradientTransform="rotate(45 0.5 0.5)">
                    <stop offset="60%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="100%" stopColor="currentColor" />
                </radialGradient>
            </defs>
            <g>
                <path fill="url(#radar_gradient0)" d="M12 0h1v13H0v-1A12 12 0.7854 0 1 12 0z" />
                <line strokeWidth="2" stroke="currentColor" strokeLinecap="round" x1="12" x2="12" y1="1" y2="12" />
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </g>
        </svg>
    );
}

function RadarDim(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle opacity="0.5" fill="url(#radar_dim_gradient1)" cx="12" cy="12" r="12" />
            <defs strokeWidth="1.25" stroke="currentColor">
                <linearGradient id="radar_dim_gradient0" gradientTransform="rotate(90 0.25 0.25)">
                    <stop offset="25%" stopColor="currentColor" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
                <radialGradient id="radar_dim_gradient1" gradientTransform="rotate(45 0.5 0.5)">
                    <stop offset="60%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="100%" stopColor="currentColor" />
                </radialGradient>
            </defs>
            <path strokeLinecap="butt" strokeLinejoin="miter" fill="url(#radar_dim_gradient0)" d="M12 0a1 1 0.7854 0 1 0.7071 0.2929C13 0.5858 13 0.9497 13 1.3137V12h-2V1.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 0z">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </path>
        </svg>
    );
}

function TripleCircle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="1.5" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs strokeWidth="2">
                <linearGradient id="triple_circle_gradient0" gradientTransform="rotate(-90 0.75 0.25)">
                    <stop offset="20%" stopColor="currentColor" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
            </defs>
            <g>
                <circle stroke="url(#triple_circle_gradient0)" transform="rotate(120 12 7.5)" cx="12" cy="7.5" r="6.75">
                    <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 7.5; 360 12 7.5" />
                </circle>
            </g>
            <g transform="rotate(120 12 12)">
                <circle stroke="url(#triple_circle_gradient0)" transform="rotate(120 12 7.5)" cx="12" cy="7.5" r="6.75">
                    <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 7.5; 360 12 7.5" />
                </circle>
            </g>
            <g transform="rotate(-120 12 12)">
                <circle stroke="url(#triple_circle_gradient0)" transform="rotate(120 12 7.5)" cx="12" cy="7.5" r="6.75">
                    <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 7.5; 360 12 7.5" />
                </circle>
            </g>
        </svg>
    );
}

function Knot(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="5s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                <path opacity="0.3" d="M12 11.9528c-8.0476 13.9389-16.0953 0 0 0s8.0476 13.9389 0 0c-8.0476-13.939 8.0476-13.939 0 0" />
                <circle stroke="none" fill="currentColor" cx="12" cy="1.5" r="1.5">
                    <animateMotion dur="3s" path="M0 10.4528c-8.0476 13.9389-16.0953 0 0 0s8.0476 13.9389 0 0c-8.0476-13.939 8.0476-13.939 0 0" repeatCount="indefinite" />
                </circle>
                <g transform="rotate(120 12 12)">
                    <circle stroke="none" fill="currentColor" cx="12" cy="1.5" r="1.5">
                        <animateMotion dur="3s" path="M0 10.4528c-8.0476 13.9389-16.0953 0 0 0s8.0476 13.9389 0 0c-8.0476-13.939 8.0476-13.939 0 0" repeatCount="indefinite" />
                    </circle>
                </g>
                <g transform="rotate(-120 12 12)">
                    <circle stroke="none" fill="currentColor" cx="12" cy="1.5" r="1.5">
                        <animateMotion dur="3s" path="M0 10.4528c-8.0476 13.9389-16.0953 0 0 0s8.0476 13.9389 0 0c-8.0476-13.939 8.0476-13.939 0 0" repeatCount="indefinite" />
                    </circle>
                </g>
            </g>
        </svg>
    );
}

function DualWormSquircle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" strokeDasharray="10 63" strokeDashoffset="11" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <path opacity="0.25" d="M9.3823 1.5h5.2354c2.1838 0 4.3676 0 6.1249 1.7574C22.5 5.0147 22.5 7.1985 22.5 9.3823v5.2354c0 2.1838 0 4.3676-1.7574 6.1249C18.9853 22.5 16.8015 22.5 14.6177 22.5H9.3823c-2.1838 0-4.3676 0-6.1249-1.7574C1.5 18.9853 1.5 16.8015 1.5 14.6177V9.3823c0-2.1838 0-4.3676 1.7574-6.1249C5.0147 1.5 7.1985 1.5 9.3823 1.5z" strokeDasharray="1" />
            <path d="M9.3823 1.5h5.2354c2.1838 0 4.3676 0 6.1249 1.7574C22.5 5.0147 22.5 7.1985 22.5 9.3823v5.2354c0 2.1838 0 4.3676-1.7574 6.1249C18.9853 22.5 16.8015 22.5 14.6177 22.5H9.3823c-2.1838 0-4.3676 0-6.1249-1.7574C1.5 18.9853 1.5 16.8015 1.5 14.6177V9.3823c0-2.1838 0-4.3676 1.7574-6.1249C5.0147 1.5 7.1985 1.5 9.3823 1.5z">
                <animate attributeName="stroke-dashoffset" dur="1.5s" repeatCount="indefinite" values="110; 38" />
            </path>
            <path transform="rotate(180 12 12)" d="M9.3823 1.5h5.2354c2.1838 0 4.3676 0 6.1249 1.7574C22.5 5.0147 22.5 7.1985 22.5 9.3823v5.2354c0 2.1838 0 4.3676-1.7574 6.1249C18.9853 22.5 16.8015 22.5 14.6177 22.5H9.3823c-2.1838 0-4.3676 0-6.1249-1.7574C1.5 18.9853 1.5 16.8015 1.5 14.6177V9.3823c0-2.1838 0-4.3676 1.7574-6.1249C5.0147 1.5 7.1985 1.5 9.3823 1.5z">
                <animate attributeName="stroke-dashoffset" dur="1.5s" repeatCount="indefinite" values="110; 38" />
            </path>
        </svg>
    );
}

function WormSquircle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="3" stroke="currentColor" strokeLinecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <path d="M9.3823 1.5h5.2354c2.1838 0 4.3676 0 6.1249 1.7574C22.5 5.0147 22.5 7.1985 22.5 9.3823v5.2354c0 2.1838 0 4.3676-1.7574 6.1249C18.9853 22.5 16.8015 22.5 14.6177 22.5H9.3823c-2.1838 0-4.3676 0-6.1249-1.7574C1.5 18.9853 1.5 16.8015 1.5 14.6177V9.3823c0-2.1838 0-4.3676 1.7574-6.1249C5.0147 1.5 7.1985 1.5 9.3823 1.5z" strokeDasharray="10 63" strokeDashoffset="11">
                <animate attributeName="stroke-dashoffset" dur="1s" repeatCount="indefinite" values="110; 38" />
            </path>
            <path opacity="0.25" d="M9.3823 1.5h5.2354c2.1838 0 4.3676 0 6.1249 1.7574C22.5 5.0147 22.5 7.1985 22.5 9.3823v5.2354c0 2.1838 0 4.3676-1.7574 6.1249C18.9853 22.5 16.8015 22.5 14.6177 22.5H9.3823c-2.1838 0-4.3676 0-6.1249-1.7574C1.5 18.9853 1.5 16.8015 1.5 14.6177V9.3823c0-2.1838 0-4.3676 1.7574-6.1249C5.0147 1.5 7.1985 1.5 9.3823 1.5z" />
        </svg>
    );
}

function Snowball(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="11" />
            <g>
                <circle cx="12" cy="4" r="3">
                    <animate attributeName="r" dur="8s" repeatCount="indefinite" values="3; 8; 3" />
                    <animate attributeName="cy" dur="8s" repeatCount="indefinite" values="4; 9; 4" />
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
                </circle>
            </g>
        </svg>
    );
}

function Sweeper(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
                <path d="M8 22.2501C3.9026 20.65 1 16.664 1 12 1 5.9249 5.9249 1 12 1s11 4.9249 11 11c0 4.664-2.9026 8.65-7 10.2501" />
                <line x1="12" x2="12" y1="23" y2="12" />
            </g>
        </svg>
    );
}

function SmoothClock(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="12" r="11" />
            <path stroke="none" fill="currentColor" d="M12 4a1 1 0.7854 0 1 0.7071 0.2929C13 4.5858 13 4.9497 13 5.3137v6.3726c0 0.364 0 0.7279-0.2929 1.0208A1 1 0.7854 0 1 12 13a1 1 0.7854 0 1-0.7071-0.2929C11 12.4142 11 12.0503 11 11.6863V5.3137c0-0.364 0-0.7279 0.2929-1.0208A1 1 0.7854 0 1 12 4z">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </path>
        </svg>
    );
}

function DiscreteClock(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeWidth="1.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <defs>
                <linearGradient id="discrete_clock_gradient0" gradientTransform="rotate(90 0.25 0.25)">
                    <stop offset="0%" stopColor="currentColor" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path opacity="0.4" strokeWidth="2" d="M1 12h3M12 23v-3M23 12h-3M12 1v3M2.4738 6.5 5.0718 8M2.4738 17.5 5.0718 16M6.5 21.5263 8 18.9282M17.5 21.5263 16 18.9282M21.5263 17.5 18.9282 16M21.5263 6.5 18.9282 8M6.5 2.4737 8 5.0718M17.5 2.4737 16 5.0718" />
            <path stroke="none" fill="url(#discrete_clock_gradient0)" d="M13 14V1c0-0.5523-0.4477-1-1-1s-1 0.4477-1 1v13z">
                <animateTransform attributeName="transform" calcMode="discrete" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;30 12 12; 60 12 12; 90 12 12; 120 12 12; 150 12 12; 180 12 12; 210 12 12; 240 12 12; 270 12 12; 300 12 12; 330 12 12;" />
            </path>
        </svg>
    );
}

function HexagonSticks(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} strokeLinecap="round" strokeLinejoin="round" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <path opacity="0.3" d="M8 1h8v2H8z">
                <animate id="hexagon_sticks_a0" attributeName="opacity" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
            <path opacity="0.3" d="M19.5263 3.0359l4 6.9282-1.7321 1-4-6.9282z">
                <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+0.2s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
            <path opacity="0.3" d="M23.5263 14.0359l-4 6.9282-1.7321-1 4-6.9282z">
                <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+0.4s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
            <path opacity="0.3" d="M16 23H8v-2h8z">
                <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+0.6s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
            <path opacity="0.3" d="M4.4737 20.9641l-4-6.9282 1.7321-1 4 6.9282z">
                <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+0.8s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
            <path opacity="0.3" d="M0.4737 9.9641l4-6.9282 1.7321 1-4 6.9282z">
                <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+1s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
        </svg>
    );
}

function Diamond(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <path opacity="0.3" d="M8 6l4-4 4 4-4 4z">
                <animate id="diamond_a0" attributeName="opacity" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
            <path opacity="0.3" d="M14 12l4-4 4 4-4 4z">
                <animate attributeName="opacity" begin="diamond_a0.begin+0.2s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
            <path opacity="0.3" d="M8 18l4-4 4 4-4 4z">
                <animate attributeName="opacity" begin="diamond_a0.begin+0.4s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
            <path opacity="0.3" d="M2 12 6 8l4 4-4 4z">
                <animate attributeName="opacity" begin="diamond_a0.begin+0.6s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </path>
        </svg>
    );
}

function Matrix(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <rect opacity="0.3" width="4" height="4" x="10" y="3">
                <animate id="matrix_a0" attributeName="opacity" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <rect opacity="0.3" width="4" height="4" x="17" y="3">
                <animate attributeName="opacity" begin="matrix_a0.begin+0.1s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <rect opacity="0.3" width="4" height="4" x="17" y="10">
                <animate attributeName="opacity" begin="matrix_a0.begin+0.2s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <rect opacity="0.3" width="4" height="4" x="10" y="10">
                <animate attributeName="opacity" dur="0.4s" repeatCount="indefinite" values="0.3; 1; 0.3" />
            </rect>
            <rect opacity="0.3" width="4" height="4" x="17" y="17">
                <animate attributeName="opacity" begin="matrix_a0.begin+0.3s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <rect opacity="0.3" width="4" height="4" x="10" y="17">
                <animate attributeName="opacity" begin="matrix_a0.begin+0.4s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <rect opacity="0.3" width="4" height="4" x="3" y="17">
                <animate attributeName="opacity" begin="matrix_a0.begin+0.5s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <rect opacity="0.3" width="4" height="4" x="3" y="10">
                <animate attributeName="opacity" begin="matrix_a0.begin+0.6s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <rect opacity="0.3" width="4" height="4" x="3" y="3">
                <animate attributeName="opacity" begin="matrix_a0.begin+0.7s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
        </svg>
    );
}

function BurstingSquares(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <rect width="4" height="4" transformOrigin="5 5" x="3" y="3">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.6; 0.8; 1; 1" repeatCount="indefinite" type="scale" values="1; 1; 1.5; 1; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="5 12" x="3" y="10">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.4; 0.6; 1; 1" repeatCount="indefinite" type="scale" values="1; 1; 1.5; 1; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="5 19" x="3" y="17">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.6; 0.8; 1; 1" repeatCount="indefinite" type="scale" values="1; 1; 1.5; 1; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="12 5" x="10" y="3">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.4; 0.6; 1; 1" repeatCount="indefinite" type="scale" values="1; 1; 1.5; 1; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="12 12" x="10" y="10">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0; 0.4; 1; 1" repeatCount="indefinite" type="scale" values="1; 1; 1.5; 1; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="12 19" x="10" y="17">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.4; 0.6; 1; 1" repeatCount="indefinite" type="scale" values="1; 1; 1.5; 1; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="19 5" x="17" y="3">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.6; 0.8; 1; 1" repeatCount="indefinite" type="scale" values="1; 1; 1.5; 1; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="19 12" x="17" y="10">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.4; 0.6; 1; 1" repeatCount="indefinite" type="scale" values="1; 1; 1.5; 1; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="19 19" x="17" y="17">
                <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.6; 0.8; 1; 1" repeatCount="indefinite" type="scale" values="1; 1; 1.5; 1; 1" />
            </rect>
        </svg>
    );
}

function PulsatingSquares(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <rect width="4" height="4" transformOrigin="5 5" x="3" y="3">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="scale" values="1; 1.5; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="5 12" x="3" y="10">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="scale" values="1.5; 1; 1.5" />
            </rect>
            <rect width="4" height="4" transformOrigin="5 19" x="3" y="17">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="scale" values="1; 1.5; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="12 5" x="10" y="3">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="scale" values="1.5; 1; 1.5" />
            </rect>
            <rect width="4" height="4" transformOrigin="12 12" x="10" y="10">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="scale" values="1; 1.5; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="12 19" x="10" y="17">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="scale" values="1.5; 1; 1.5" />
            </rect>
            <rect width="4" height="4" transformOrigin="19 5" x="17" y="3">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="scale" values="1; 1.5; 1" />
            </rect>
            <rect width="4" height="4" transformOrigin="19 12" x="17" y="10">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="scale" values="1.5; 1; 1.5" />
            </rect>
            <rect width="4" height="4" transformOrigin="19 19" x="17" y="17">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="scale" values="1; 1.5; 1" />
            </rect>
        </svg>
    );
}

function RescalingJoggle(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="5" r="3">
                <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="12; 19.7942" />
                <animate attributeName="cy" dur="1s" repeatCount="indefinite" values="5; 18.5" />
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="4; 2; 4" />
            </circle>
            <circle cx="19.794201" cy="18.5" r="3">
                <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="19.7942; 4.20577" />
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="4; 2; 4" />
            </circle>
            <circle cx="4.20577" cy="18.5" r="3">
                <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="4.20577; 12" />
                <animate attributeName="cy" dur="1s" repeatCount="indefinite" values="18.5; 5" />
                <animate attributeName="r" dur="1s" repeatCount="indefinite" values="4; 2; 4" />
            </circle>
        </svg>
    );
}

function JogglingCircles(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <circle cx="12" cy="5" r="3">
                <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="12; 19.7942" />
                <animate attributeName="cy" dur="1s" repeatCount="indefinite" values="5; 18.5" />
            </circle>
            <circle cx="19.794201" cy="18.5" r="3">
                <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="19.7942; 4.20577" />
            </circle>
            <circle cx="4.20577" cy="18.5" r="3">
                <animate attributeName="cx" dur="1s" repeatCount="indefinite" values="4.20577; 12" />
                <animate attributeName="cy" dur="1s" repeatCount="indefinite" values="18.5; 5" />
            </circle>
        </svg>
    );
}

function Snowflake(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <rect opacity="0.3" width="2" height="6" x="11">
                <animate id="snowflake_a0" attributeName="opacity" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <polygon opacity="0.4" points="16.133975 2.839746 17.866025 3.839746 14.366025 9.901924 12.633975 8.901924">
                <animate attributeName="opacity" begin="snowflake_a0.begin+0.1s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </polygon>
            <polygon opacity="0.4" points="21.892305 5.133975 22.892305 6.866025 17.696152 9.866025 16.696152 8.133975">
                <animate attributeName="opacity" begin="snowflake_a0.begin+0.2s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </polygon>
            <rect opacity="0.4" width="7" height="2" x="15" y="11">
                <animate attributeName="opacity" begin="snowflake_a0.begin+0.3s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <polygon opacity="0.4" points="22.892305 17.133975 21.892305 18.866025 16.696152 15.866025 17.696152 14.133975">
                <animate attributeName="opacity" begin="snowflake_a0.begin+0.4s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </polygon>
            <polygon opacity="0.4" points="14.366 14.0981 17.866 20.1603 16.134 21.1603 12.634 15.0981">
                <animate attributeName="opacity" begin="snowflake_a0.begin+0.5s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </polygon>
            <rect opacity="0.4" width="2" height="6" x="11" y="18">
                <animate attributeName="opacity" begin="snowflake_a0.begin+0.6s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <polygon opacity="0.4" points="11.366 15.0981 7.866 21.1603 6.134 20.1603 9.634 14.0981">
                <animate attributeName="opacity" begin="snowflake_a0.begin+0.7s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </polygon>
            <polygon opacity="0.4" points="2.107695 18.866025 1.107695 17.133975 6.303848 14.133975 7.303848 15.866025">
                <animate attributeName="opacity" begin="snowflake_a0.begin+0.8s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </polygon>
            <rect opacity="0.4" width="7" height="2" x="2" y="11">
                <animate attributeName="opacity" begin="snowflake_a0.begin+0.9s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </rect>
            <polygon opacity="0.4" points="1.107695 6.866025 2.107695 5.133975 7.303848 8.133975 6.303848 9.866025">
                <animate attributeName="opacity" begin="snowflake_a0.begin+1s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </polygon>
            <polygon opacity="0.4" points="9.634 9.9019 6.134 3.8397 7.866 2.8397 11.366 8.9019">
                <animate attributeName="opacity" begin="snowflake_a0.begin+1.1s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
            </polygon>
        </svg>
    );
}

function JogglingSquares(props) {
    const width = 24;
    const height = 24;
    const {"left": l, "top": t, ...attrs} = props;
    const dx = (l && -toNumber(l, width)) || 0;
    const dy = (t && -toNumber(t, height)) || 0;
    const x = 0 + dx;
    const y = 0 + dy;
    return (
        <svg viewBox={`${x} ${y} ${width} ${height}`} fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" {...attrs}>
            <style>{`${styles}`}</style>
            <g>
                <animateTransform attributeName="transform" dur="4s" repeatCount="indefinite" type="rotate" values="360 12 12; 0 12 12" />
                <polygon points="7 5 12 0 17 5 12 10" transformOrigin="12 5">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; 45; 45; 90; 90" />
                </polygon>
                <polygon points="19 7 24 12 19 17 14 12" transformOrigin="19 12">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; 45; 45; 90; 90" />
                </polygon>
                <polygon points="17 19 12 24 7 19 12 14" transformOrigin="12 19">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; 45; 45; 90; 90" />
                </polygon>
                <polygon points="5 17 0 12 5 7 10 12" transformOrigin="5 12">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0; 45; 45; 90; 90" />
                </polygon>
            </g>
        </svg>
    );
}

function toNumber(s, parentLength) {
    let m;
    let n;
    try {
        m = s.trim().match(/(.*)%$/);
        if (m && m[1]) {
            n = parseFloat(m[1]);
            if (!Number.isNaN(n)) {
                return n / 100 * parentLength;
            }
        } else {
            n = parseFloat(s);
            if (!Number.isNaN(n)) {
                return n;
            }
        }
        return 0;
    } catch (ignore) {
        return 0;
    }
}

export {Windy, JogglingCapsules, JogglingLava, JogglingEllipses, JogglingSticks, JogglingTriangles, Train, SingularRipple, CollidingRipples, WaterRipples, Stick, RotationWave, TrailingGhosts, CollidingBalls, SmoothPulsingCircle, CollidingSpotlights, CollidingRotatingBalls, QuadLights, BreathingCircle, PulsingCircle, Star, RadialBlur, EclipsedDots, EllipsisBouncingStretched, Ellipsis, Hexadominoes, MorphingHexagon, OctafadeShort, EllipsisBouncingHighlight, EllipsisHighlight, OctafadeMedium, OctafadeLong, EllipsisWave, Rings, Sphere, Tangled, Hexablossom, Hexastar, Sticks, EclipsedCrescent, MorphingEllipse, VerticalBounce, FadingCrescent, ResizingFadingRing, HorizontalBounce, FarClose, FadingRing, FadingBarsWave, Traffic, TrafficContinuous, BarsWave, Bars, BigBouncingEllipsis, BigEllipsis, MorphingSparkle, DualDynamicTails, ComplementingFadingArcs, EllipticCircles, ComplementingArcs, PulsatingCapsules, DynamicArc, StaticArc, Lights, DualResizingArcs, Stubborn, DualFadingRing, DelayedDynamicArcOnCircle, DelayedDynamicArc, AcceleratingDualArcs, Hole, DynamicArcOnCircle, QuadChase, TripleTails, Opposites, Worm, CircularArrow, DualCircularArrows, PausingCircularArrows, Spirals, ArcAroundPulse, Spiral, PulsingSwirl, Swirl, Fireball, Wormhole, FadingSpirals, FadingArrows, FadingTriangles, GradualFadedBump, GradualBump, LargeRotatingSingleton, Lazy, Ring, FadingMeteor, DualFadingTails, ShadowedGauge, Dance, FadingSticks, FadingSlants, FadingCircles, FadingSlices, RotatingPendulum, SmallRotatingSingleton, ShortTick, LongTick, HexagonSquare, MorphingSquare, MorphingSquares, Radar, RadarDim, TripleCircle, Knot, DualWormSquircle, WormSquircle, Snowball, Sweeper, SmoothClock, DiscreteClock, HexagonSticks, Diamond, Matrix, BurstingSquares, PulsatingSquares, RescalingJoggle, JogglingCircles, Snowflake, JogglingSquares};