/**
 * Film Burn Transition - WebGPU Shader-based Cinematic Effect
 * ============================================================
 * Creates a smooth cross-dissolve with organic light leaks and warm glows.
 * The effect adds subtle film burn overlays while transitioning between images.
 */

class FilmBurnTransition {
    constructor() {
        this.device = null;
        this.context = null;
        this.canvas = null;
        this.pipeline = null;
        this.sampler = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return true;

        if (!navigator.gpu) {
            console.warn('WebGPU not supported, falling back to CSS transitions');
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.warn('No WebGPU adapter found');
                return false;
            }

            this.device = await adapter.requestDevice();

            this.canvas = document.createElement('canvas');
            this.canvas.id = 'film-burn-canvas';
            this.canvas.style.cssText = `
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                z-index: 2000;
                display: none;
            `;
            document.body.appendChild(this.canvas);

            this.context = this.canvas.getContext('webgpu');
            const format = navigator.gpu.getPreferredCanvasFormat();

            this.context.configure({
                device: this.device,
                format: format,
                alphaMode: 'premultiplied',
            });

            await this.createPipeline(format);
            this.initialized = true;
            return true;
        } catch (e) {
            console.error('WebGPU init failed:', e);
            return false;
        }
    }

    async createPipeline(format) {
        const shaderCode = `
            struct Uniforms {
                progress: f32,
                time: f32,
                aspectRatio: f32,
                padding: f32,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var srcTexture: texture_2d<f32>;
            @group(0) @binding(2) var dstTexture: texture_2d<f32>;
            @group(0) @binding(3) var texSampler: sampler;

            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) uv: vec2f,
            }

            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                var pos = array<vec2f, 3>(
                    vec2f(-1.0, -1.0),
                    vec2f(3.0, -1.0),
                    vec2f(-1.0, 3.0)
                );
                var uv = array<vec2f, 3>(
                    vec2f(0.0, 1.0),
                    vec2f(2.0, 1.0),
                    vec2f(0.0, -1.0)
                );

                var output: VertexOutput;
                output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
                output.uv = uv[vertexIndex];
                return output;
            }

            // Simplex-like noise for organic patterns
            fn hash(p: vec2f) -> f32 {
                return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
            }

            fn noise(p: vec2f) -> f32 {
                let i = floor(p);
                let f = fract(p);
                let u = f * f * (3.0 - 2.0 * f);

                return mix(
                    mix(hash(i + vec2f(0.0, 0.0)), hash(i + vec2f(1.0, 0.0)), u.x),
                    mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x),
                    u.y
                );
            }

            // Fractal brownian motion for organic light leak shapes
            fn fbm(p: vec2f, time: f32) -> f32 {
                var value = 0.0;
                var amplitude = 0.5;
                var frequency = 1.0;
                var pt = p;

                for (var i = 0; i < 4; i++) {
                    value += amplitude * noise(pt * frequency + time * 0.1);
                    amplitude *= 0.5;
                    frequency *= 2.0;
                }
                return value;
            }

            // Screen blend: makes things brighter where both are bright
            fn screenBlend(base: vec3f, blend: vec3f) -> vec3f {
                return 1.0 - (1.0 - base) * (1.0 - blend);
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4f {
                let uv = input.uv;
                let p = uniforms.progress;
                let time = uniforms.time;

                // Sample both images
                let srcColor = textureSample(srcTexture, texSampler, uv).rgb;
                let dstColor = textureSample(dstTexture, texSampler, uv).rgb;

                // === CROSS-DISSOLVE ===
                // Smooth transition from source to destination
                // Use an S-curve for more cinematic feel
                let dissolve = smoothstep(0.0, 1.0, p);
                var result = mix(srcColor, dstColor, dissolve);

                // === ORGANIC LIGHT LEAKS ===
                // Create multiple light leak sources at edges
                let leak1 = fbm(uv * 3.0 + vec2f(0.0, time), time);
                let leak2 = fbm(uv * 2.0 + vec2f(time * 0.5, 0.0), time * 0.7);

                // Light leaks come from corners/edges
                let cornerTL = (1.0 - uv.x) * uv.y;
                let cornerBR = uv.x * (1.0 - uv.y);
                let edgeStrength = max(cornerTL, cornerBR) * 0.5;

                // Combine leaks with edge mask
                let leakPattern = (leak1 * 0.6 + leak2 * 0.4) * edgeStrength;

                // Light leaks are most visible in the middle of the transition
                let leakTiming = sin(p * 3.14159); // peaks at p=0.5
                let leakIntensity = leakPattern * leakTiming * 0.4;

                // Warm light leak colors (oranges, yellows, soft reds)
                let warmColor = vec3f(1.0, 0.85, 0.6);
                let leakColor = warmColor * leakIntensity;

                // Apply light leak using screen blend (additive-ish, but clamped)
                result = screenBlend(result, leakColor);

                // === SUBTLE FILM GRAIN ===
                let grain = (hash(uv * 1000.0 + time) - 0.5) * 0.02;
                result = result + grain;

                // === VIGNETTE that fades during transition ===
                let center = vec2f(0.5, 0.5);
                let dist = distance(uv, center);
                let vignette = 1.0 - smoothstep(0.4, 0.9, dist) * 0.3 * (1.0 - p);
                result = result * vignette;

                return vec4f(clamp(result, vec3f(0.0), vec3f(1.0)), 1.0);
            }
        `;

        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            ]
        });

        this.pipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout]
            }),
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: format }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        this.uniformBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    async loadTexture(imageSrc) {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imageSrc;
        });

        const bitmap = await createImageBitmap(img);

        const texture = this.device.createTexture({
            size: [bitmap.width, bitmap.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture: texture },
            [bitmap.width, bitmap.height]
        );

        return texture;
    }

    /**
     * Run the film burn transition
     * @param {string} srcImage - Source image (fading OUT)
     * @param {string} dstImage - Destination image (fading IN - this is what remains!)
     * @param {number} duration - Transition duration in ms
     */
    async transition(srcImage, dstImage, duration = 2000) {
        if (!this.initialized) {
            const success = await this.init();
            if (!success) {
                return this.fallbackTransition(srcImage, dstImage, duration);
            }
        }

        this.canvas.width = window.innerWidth * window.devicePixelRatio;
        this.canvas.height = window.innerHeight * window.devicePixelRatio;
        this.canvas.style.display = 'block';

        // Load textures - src fades out, dst fades in
        const [srcTexture, dstTexture] = await Promise.all([
            this.loadTexture(srcImage),
            this.loadTexture(dstImage)
        ]);

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: srcTexture.createView() },
                { binding: 2, resource: dstTexture.createView() },
                { binding: 3, resource: this.sampler },
            ]
        });

        return new Promise((resolve) => {
            const startTime = performance.now();

            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1.0);

                // Ease-in-out for smooth feel
                const easedProgress = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;

                const uniformData = new Float32Array([
                    easedProgress,
                    elapsed / 1000,
                    window.innerWidth / window.innerHeight,
                    0
                ]);
                this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

                const commandEncoder = this.device.createCommandEncoder();
                const textureView = this.context.getCurrentTexture().createView();

                const renderPass = commandEncoder.beginRenderPass({
                    colorAttachments: [{
                        view: textureView,
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'store',
                    }]
                });

                renderPass.setPipeline(this.pipeline);
                renderPass.setBindGroup(0, bindGroup);
                renderPass.draw(3);
                renderPass.end();

                this.device.queue.submit([commandEncoder.finish()]);

                if (progress < 1.0) {
                    requestAnimationFrame(animate);
                } else {
                    srcTexture.destroy();
                    dstTexture.destroy();
                    resolve();
                }
            };

            requestAnimationFrame(animate);
        });
    }

    async fallbackTransition(srcImage, dstImage, duration) {
        // Simple CSS cross-fade fallback
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed; inset: 0; z-index: 2000;
        `;
        container.innerHTML = `
            <img src="${dstImage}" style="
                position: absolute; inset: 0; width: 100%; height: 100%;
                object-fit: cover;
            ">
            <img src="${srcImage}" style="
                position: absolute; inset: 0; width: 100%; height: 100%;
                object-fit: cover;
                transition: opacity ${duration}ms ease-in-out;
            ">
        `;
        document.body.appendChild(container);

        await new Promise(r => setTimeout(r, 50));

        // Fade out source, revealing destination
        container.children[1].style.opacity = '0';

        await new Promise(r => setTimeout(r, duration));
        container.remove();
    }

    hide() {
        if (this.canvas) {
            this.canvas.style.display = 'none';
        }
    }

    destroy() {
        if (this.canvas) {
            this.canvas.remove();
        }
        this.initialized = false;
    }
}

const filmBurn = new FilmBurnTransition();

async function filmBurnTransition(srcImage, dstImage, duration = 2000) {
    return filmBurn.transition(srcImage, dstImage, duration);
}

function hideFilmBurn() {
    filmBurn.hide();
}
