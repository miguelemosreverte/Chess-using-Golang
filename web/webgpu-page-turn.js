/**
 * WebGPU Book Page Turn Effect
 * Ported from ShaderToy page curl shader
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
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
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
            console.error('WebGPU init failed:', e);
            return false;
        }
    }

    async createPipeline(format) {
        // Page curl shader ported from ShaderToy
        const shaderCode = `
            struct Uniforms {
                progress: f32,    // 0 = flat, 1 = fully turned
                radius: f32,      // Curl cylinder radius
                aspect: f32,      // Canvas aspect ratio
                time: f32,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var currentImg: texture_2d<f32>;
            @group(0) @binding(2) var nextImg: texture_2d<f32>;
            @group(0) @binding(3) var samp: sampler;

            const PI: f32 = 3.14159265359;

            struct VSOut {
                @builtin(position) pos: vec4f,
                @location(0) uv: vec2f,
            }

            @vertex
            fn vs_main(@builtin(vertex_index) i: u32) -> VSOut {
                var p = array<vec2f, 6>(
                    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
                    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1)
                );
                var out: VSOut;
                out.pos = vec4f(p[i], 0, 1);
                out.uv = p[i] * 0.5 + 0.5;
                return out;
            }

            @fragment
            fn fs_main(in: VSOut) -> @location(0) vec4f {
                let progress = uniforms.progress;
                let radius = uniforms.radius;
                let aspect = uniforms.aspect;

                // Flip Y for correct image orientation
                let flippedUV = vec2f(in.uv.x, 1.0 - in.uv.y);

                // Scale UV to aspect ratio (like ShaderToy)
                var uv = flippedUV * vec2f(aspect, 1.0);

                // Simulate mouse movement: drag from right edge to left
                // At progress=0: mouse at right edge, page flat
                // At progress=1: mouse at left edge, page fully turned
                let mouseX = aspect * (1.0 - progress);
                let mouseY = 0.5;
                let mouse = vec2f(mouseX, mouseY);

                // Direction of page turn (right to left)
                let mouseDir = vec2f(-1.0, 0.0);

                // Origin point where curl axis meets edge
                let origin = clamp(mouse - mouseDir * mouse.x / mouseDir.x, vec2f(0.0), vec2f(1.0));

                // Distance the curl has traveled
                let mouseDist = length(mouse - origin);

                // Project current point onto curl direction
                let proj = dot(uv - origin, mouseDir);
                let dist = proj - mouseDist;

                // Point on the curl axis line
                let linePoint = uv - dist * mouseDir;

                // Pre-sample both textures (WebGPU uniform control flow)
                let texCoord = flippedUV;

                let currentCol = textureSampleLevel(currentImg, samp, texCoord, 0.0);
                let nextCol = textureSampleLevel(nextImg, samp, texCoord, 0.0);

                // Calculate all possible UV coordinates
                let theta = asin(clamp(dist / radius, 0.0, 1.0));
                let p2 = linePoint + mouseDir * (PI - theta) * radius;
                let p1 = linePoint + mouseDir * theta * radius;
                let pBehind = linePoint + mouseDir * (abs(dist) + PI * radius);

                // Sample at cylinder positions (convert back to UV space)
                let p2UV = vec2f(p2.x / aspect, p2.y);
                let p1UV = vec2f(p1.x / aspect, p1.y);
                let pBehindUV = vec2f(pBehind.x / aspect, pBehind.y);

                let p2Valid = p2.x <= aspect && p2.y <= 1.0 && p2.x > 0.0 && p2.y > 0.0;
                let pBehindValid = pBehind.x <= aspect && pBehind.y <= 1.0 && pBehind.x > 0.0 && pBehind.y > 0.0;

                let cylUV = select(p1UV, p2UV, p2Valid);
                let behindUV = select(texCoord, pBehindUV, pBehindValid);

                let currentAtCyl = textureSampleLevel(currentImg, samp, cylUV, 0.0);
                let currentAtBehind = textureSampleLevel(currentImg, samp, behindUV, 0.0);

                // Determine final color based on position
                var col: vec4f;

                if (dist > radius) {
                    // Past the curl - show next page with shadow
                    col = nextCol;
                    let shadow = pow(clamp(dist - radius, 0.0, 1.0) * 1.5, 0.2);
                    col = vec4f(col.rgb * shadow, col.a);
                } else if (dist >= 0.0) {
                    // On the cylinder - show curled current page
                    col = currentAtCyl;
                    let shadow = pow(clamp((radius - dist) / radius, 0.0, 1.0), 0.2);
                    col = vec4f(col.rgb * shadow, col.a);
                } else {
                    // Before the curl - show current page (possibly wrapped)
                    col = currentAtBehind;
                }

                return col;
            }
        `;

        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        const info = await shaderModule.getCompilationInfo();
        for (const msg of info.messages) {
            console.error(`Shader ${msg.type}: ${msg.message} at line ${msg.lineNum}`);
        }

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            ]
        });

        this.pipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                    }
                }],
            },
        });

        this.bindGroupLayout = bindGroupLayout;
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
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

        this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
        return texture;
    }

    async animatePageTurn(currentImage, nextImage, duration = 1000, container = document.body) {
        if (!this.initialized && !await this.init()) return false;

        this.canvas.width = container.clientWidth * window.devicePixelRatio;
        this.canvas.height = container.clientHeight * window.devicePixelRatio;

        this.context.configure({
            device: this.device,
            format: navigator.gpu.getPreferredCanvasFormat(),
            alphaMode: 'premultiplied',
        });

        if (!this.canvas.parentNode) {
            container.appendChild(this.canvas);
        }

        if (this.canvas.width === 0 || this.canvas.height === 0) {
            console.error('Canvas has zero dimensions!');
            return false;
        }

        const [currentTex, nextTex] = await Promise.all([
            this.loadTexture(currentImage).catch(e => { console.error('Load current failed:', e); return null; }),
            this.loadTexture(nextImage || currentImage).catch(e => { console.error('Load next failed:', e); return null; })
        ]);

        if (!currentTex || !nextTex) return false;

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: currentTex.createView() },
                { binding: 2, resource: nextTex.createView() },
                { binding: 3, resource: this.sampler },
            ]
        });

        const aspect = this.canvas.width / this.canvas.height;

        return new Promise(resolve => {
            const start = performance.now();
            console.log('Animation starting, duration:', duration);

            const frame = () => {
                const t = Math.min((performance.now() - start) / duration, 1);
                // Smooth ease-in-out curve
                const progress = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

                console.log('Frame t:', t.toFixed(3), 'progress:', progress.toFixed(3));

                this.device.queue.writeBuffer(
                    this.uniformBuffer, 0,
                    new Float32Array([progress, 0.1, aspect, t])
                );

                const encoder = this.device.createCommandEncoder();
                const pass = encoder.beginRenderPass({
                    colorAttachments: [{
                        view: this.context.getCurrentTexture().createView(),
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        loadOp: 'clear',
                        storeOp: 'store',
                    }]
                });

                pass.setPipeline(this.pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.draw(6);
                pass.end();

                this.device.queue.submit([encoder.finish()]);

                if (t < 1) {
                    requestAnimationFrame(frame);
                } else {
                    console.log('Animation complete');
                    currentTex.destroy();
                    nextTex.destroy();
                    resolve(true);
                }
            };

            frame();
        });
    }

    async showSpread(imageSrc, container = document.body) {
        if (!this.initialized && !await this.init()) return false;

        this.canvas.width = container.clientWidth * window.devicePixelRatio;
        this.canvas.height = container.clientHeight * window.devicePixelRatio;

        if (!this.canvas.parentNode) {
            container.appendChild(this.canvas);
        }

        const tex = await this.loadTexture(imageSrc);
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: tex.createView() },
                { binding: 2, resource: tex.createView() },
                { binding: 3, resource: this.sampler },
            ]
        });

        const aspect = this.canvas.width / this.canvas.height;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([0, 0.1, aspect, 0]));

        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
            }]
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(6);
        pass.end();

        this.device.queue.submit([encoder.finish()]);
        this.currentTexture = tex;
    }

    hide() {
        if (this.canvas?.parentNode) this.canvas.remove();
        if (this.currentTexture) {
            this.currentTexture.destroy();
            this.currentTexture = null;
        }
    }
}

const webgpuPageTurn = new WebGPUPageTurn();
