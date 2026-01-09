/**
 * WebGPU Page Turn Effect
 * =======================
 * Renders realistic page turns with:
 * - Curved page geometry
 * - Proper lighting and shadows
 * - Ambient occlusion at the spine
 */

class WebGPUPageTurn {
    constructor() {
        this.device = null;
        this.context = null;
        this.canvas = null;
        this.pipeline = null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return true;

        if (!navigator.gpu) {
            console.warn('WebGPU not supported');
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return false;

            this.device = await adapter.requestDevice();

            this.canvas = document.createElement('canvas');
            this.canvas.id = 'webgpu-page-canvas';
            this.canvas.style.cssText = `
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                z-index: 2000;
            `;

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
            console.error('WebGPU page turn init failed:', e);
            return false;
        }
    }

    async createPipeline(format) {
        const shaderCode = `
            struct Uniforms {
                time: f32,
                curlAmount: f32,     // 0 = flat, 1 = fully curled
                aspectRatio: f32,
                lightAngle: f32,
            }

            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) uv: vec2f,
                @location(1) normal: vec3f,
                @location(2) worldPos: vec3f,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var pageTexture: texture_2d<f32>;
            @group(0) @binding(2) var pageSampler: sampler;

            // Generate a curved page mesh
            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                // Create a grid of vertices for the page
                let gridSize = 32u;
                let quadIndex = vertexIndex / 6u;
                let vertInQuad = vertexIndex % 6u;

                let qx = quadIndex % gridSize;
                let qy = quadIndex / gridSize;

                // Triangle vertices within quad
                var offsets = array<vec2u, 6>(
                    vec2u(0, 0), vec2u(1, 0), vec2u(1, 1),
                    vec2u(0, 0), vec2u(1, 1), vec2u(0, 1)
                );
                let offset = offsets[vertInQuad];

                let x = f32(qx + offset.x) / f32(gridSize);
                let y = f32(qy + offset.y) / f32(gridSize);

                // Page dimensions (centered, aspect ratio corrected)
                let pageWidth = 0.6;
                let pageHeight = pageWidth * 1.4;

                // Base position
                var pos = vec3f(
                    (x - 0.5) * pageWidth,
                    (y - 0.5) * pageHeight,
                    0.0
                );

                // Apply curl deformation
                let curl = uniforms.curlAmount;
                if (curl > 0.0) {
                    // Curl from right edge (like turning a page)
                    let curlRadius = 0.15;
                    let curlAngle = curl * 3.14159;

                    // Distance from curl axis (right side curls first)
                    let distFromRight = 1.0 - x;
                    let curlProgress = clamp((curl * 2.0 - distFromRight) * 2.0, 0.0, 1.0);

                    if (curlProgress > 0.0) {
                        let angle = curlProgress * curlAngle;
                        let originalX = pos.x;

                        // Curl around cylinder
                        pos.x = pos.x - curlRadius * sin(angle) * curlProgress;
                        pos.z = curlRadius * (1.0 - cos(angle)) * curlProgress;

                        // Add slight wave for realism
                        pos.z += sin(y * 6.28) * 0.01 * curlProgress;
                    }
                }

                // Calculate normal for lighting
                var normal = vec3f(0.0, 0.0, 1.0);
                if (curl > 0.0) {
                    let curlProgress = clamp((curl * 2.0 - (1.0 - x)) * 2.0, 0.0, 1.0);
                    let angle = curlProgress * curl * 3.14159;
                    normal = vec3f(sin(angle), 0.0, cos(angle));
                }

                var output: VertexOutput;
                output.position = vec4f(pos.x * 2.0, pos.y * 2.0, pos.z, 1.0);
                output.uv = vec2f(x, 1.0 - y);
                output.normal = normal;
                output.worldPos = pos;
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4f {
                let uv = input.uv;

                // Sample page texture
                var color = textureSample(pageTexture, pageSampler, uv).rgb;

                // Lighting
                let lightDir = normalize(vec3f(0.3, 0.5, 1.0));
                let normal = normalize(input.normal);
                let diffuse = max(dot(normal, lightDir), 0.0);
                let ambient = 0.4;
                let lighting = ambient + diffuse * 0.6;

                color = color * lighting;

                // Ambient occlusion at spine (left edge)
                let spineAO = smoothstep(0.0, 0.15, uv.x);
                color = color * (0.6 + spineAO * 0.4);

                // Subtle shadow on curled part
                if (input.worldPos.z > 0.01) {
                    let shadowFactor = 1.0 - input.worldPos.z * 2.0;
                    color = color * max(shadowFactor, 0.7);
                }

                // Paper edge highlight
                let edgeHighlight = smoothstep(0.98, 1.0, uv.x) * 0.2;
                color = color + edgeHighlight;

                return vec4f(color, 1.0);
            }
        `;

        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            ]
        });

        this.pipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
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

        this.bindGroupLayout = bindGroupLayout;

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
     * Animate a page turn
     */
    async animatePageTurn(imageSrc, duration = 1000, container = document.body) {
        if (!this.initialized) {
            const success = await this.init();
            if (!success) return false;
        }

        this.canvas.width = window.innerWidth * window.devicePixelRatio;
        this.canvas.height = window.innerHeight * window.devicePixelRatio;
        container.appendChild(this.canvas);

        const texture = await this.loadTexture(imageSrc);

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: texture.createView() },
                { binding: 2, resource: this.sampler },
            ]
        });

        return new Promise((resolve) => {
            const startTime = performance.now();
            const gridSize = 32;
            const vertexCount = gridSize * gridSize * 6;

            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1.0);

                // Ease-in-out curve
                const curl = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;

                const uniformData = new Float32Array([
                    elapsed / 1000,
                    curl,
                    window.innerWidth / window.innerHeight,
                    0
                ]);
                this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

                const commandEncoder = this.device.createCommandEncoder();
                const textureView = this.context.getCurrentTexture().createView();

                const renderPass = commandEncoder.beginRenderPass({
                    colorAttachments: [{
                        view: textureView,
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        loadOp: 'clear',
                        storeOp: 'store',
                    }]
                });

                renderPass.setPipeline(this.pipeline);
                renderPass.setBindGroup(0, bindGroup);
                renderPass.draw(vertexCount);
                renderPass.end();

                this.device.queue.submit([commandEncoder.finish()]);

                if (progress < 1.0) {
                    requestAnimationFrame(animate);
                } else {
                    texture.destroy();
                    resolve(true);
                }
            };

            requestAnimationFrame(animate);
        });
    }

    hide() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.remove();
        }
    }
}

// Global instance
const webgpuPageTurn = new WebGPUPageTurn();
