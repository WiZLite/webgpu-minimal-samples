
export async function init() {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const context = canvas.getContext("webgpu");
    const devicePixelRatio = window.devicePixelRatio || 1;
    const presentationSize = [
      canvas.clientWidth * devicePixelRatio,
      canvas.clientHeight * devicePixelRatio,
    ];
    const presentationFormat = context.getPreferredFormat(adapter);
    context.configure({
      device,
      format: presentationFormat,
      size: presentationSize,
    });

    // 以前と違い、BindGroupを Pipeline から取得するのでは無く、予め指定している。
    const timeBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: "uniform",
                    minBindingSize: 4
                }
            }
        ]
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: "uniform",
                    minBindingSize: 20
                }
            }
        ]
    });

    const dynamicBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: "uniform",
                    hasDynamicOffset: true,
                    minBindingSize: 20
                }
            }
        ]
    });

    const vec4Size = 4 * Float32Array.BYTES_PER_ELEMENT;
    // bindGroupLayout から pipeline を作っており、以前と流れが逆。
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [timeBindGroupLayout, bindGroupLayout]
    });
    const dynamicPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [timeBindGroupLayout, dynamicBindGroupLayout]
    });

    const shaderModule = device.createShaderModule({
        code: `
struct Time {
    value: f32;
}

struct Uniforms {
    scale: f32;
    offsetX: f32;
    offsetY: f32;
    scalar: f32;
    scalarOffset: f32;
}

@group(0) @binding(0) var<uniform> time: Time;
@group(1) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) Position: vec4<f32>;
    @location(0) v_color: vec4<f32>;
};

@stage(vertex)
fn vert_main(@location(0) position: vec4<f32>, @location(1) color: vec4<f32>) -> VertexOutput {
    var fade: f32 = (uniforms.scalarOffset + time.value * uniforms.scalar / 10.0) % 1.0;
    if (fade < 0.5) {
        fade = fade * 2.0;
    } else {
        fade = (1.0 - fade) * 2.0;
    }
    var xpos : f32 = position.x * uniforms.scale;
    var ypos : f32 = position.y * uniforms.scale;
    var angle : f32 = 3.1415926 * 2.0 * fade;
    var xrot : f32 = xpos * cos(angle) - ypos * sin(angle);
    var yrot : f32 = xpos * sin(angle) + ypos * cos(angle);
    xpos = xrot + uniforms.offsetX;
    ypos = yrot + uniforms.offsetY;
    var output : VertexOutput;
    output.v_color = vec4<f32>(fade, 1.0 - fade, 0.0, 1.0) + color;
    output.Position = vec4<f32>(xpos, ypos, 0.0, 1.0);
    return output;
}

@stage(fragment)
fn frag_main(@location(0) v_color: vec4<f32>) -> @location(0) vec4<f32> {
    return v_color;
}
        `
    });

    const pipelineDesc: GPURenderPipelineDescriptor = {
        vertex: {
            module: shaderModule,
            entryPoint: "vert_main",
            buffers: [
                {
                    arrayStride: 2 * vec4Size,
                    stepMode: "vertex",
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: "float32x4"
                        },
                        {
                            shaderLocation: 1,
                            offset: vec4Size,
                            format: "float32x4"
                        }
                    ]
                }
            ]
        },
        fragment: {
            module: shaderModule,
            entryPoint: "frag_main",
            targets: [{ format: presentationFormat }]
        },
        primitive: {
            topology: "triangle-list",
            frontFace: "ccw",
            cullMode: "none"
        }
    };

    const pipeline = device.createRenderPipeline({ ...pipelineDesc, layout: pipelineLayout });
    const dynamicPipeline = device.createRenderPipeline({ ...pipelineDesc, layout: dynamicPipelineLayout });

    const vertexBuffer = device.createBuffer({
        size: 2 * 3 * vec4Size,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });

    new Float32Array(vertexBuffer.getMappedRange()).set([
        // position data /**/ color data
        0, 0.1, 0, 1,    /**/ 1, 0, 0, 1,
        -0.1, -0.1, 0, 1,/**/ 0, 1, 0, 1,
        0.1, -0.1, 0, 1, /**/ 0, 0, 1, 1
    ]);
    vertexBuffer.unmap();

    const settings = {
        numTriangles: 20000,
        renderBundles: false,
        dynamicOffsets: false
    };

    function configure() {
        const numTriangles = settings.numTriangles;
        const uniformBytes = 5 * Float32Array.BYTES_PER_ELEMENT;
        const alignedUniformBytes = Math.ceil(uniformBytes / 256) * 256;
        const alignedUniformFloats = alignedUniformBytes / Float32Array.BYTES_PER_ELEMENT;
        const uniformBuffer = device.createBuffer({
            size: numTriangles * alignedUniformBytes + Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM
        });
        const uniformBufferData = new Float32Array(numTriangles * alignedUniformFloats);
        const bindGroups = new Array(numTriangles);
        for(let i = 0; i < numTriangles; ++i) {
            uniformBufferData[alignedUniformFloats * i + 0] = Math.random() * 0.2 + 0.2; // scale;
            uniformBufferData[alignedUniformFloats * i + 1] = 0.9 * 2 * (Math.random() - 0.5); // offsetX;
            uniformBufferData[alignedUniformFloats * i + 2] = 0.9 * 2 * (Math.random() - 0.5); // offsetY;
            uniformBufferData[alignedUniformFloats * i + 3] = Math.random() * 1.5 + 0.5; // scalar;
            uniformBufferData[alignedUniformFloats * i + 4] = Math.random() * 10; // scalarOffset;

            bindGroups[i] = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: {
                            buffer: uniformBuffer,
                            offset: i * alignedUniformBytes,
                            size: 6 * Float32Array.BYTES_PER_ELEMENT
                        }
                    }
                ]
            });
        }
        

        const dynamicBindGroup = device.createBindGroup({
            layout: dynamicBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: uniformBuffer,
                        offset: 0,
                        size: 6 * Float32Array.BYTES_PER_ELEMENT
                    }
                }
            ]
        });

        const timeOffset = numTriangles * alignedUniformBytes;
        const timeBindGroup = device.createBindGroup({
            layout: timeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: uniformBuffer,
                        offset: timeOffset,
                        size: Float32Array.BYTES_PER_ELEMENT
                    }
                }
            ]
        });

        const maxMappingLength = (14 * 1024 * 1024) / Float32Array.BYTES_PER_ELEMENT;
        for(let offset = 0; offset < uniformBufferData.length; offset += maxMappingLength) {

            const uploadCount = Math.min(uniformBufferData.length - offset, maxMappingLength);

            device.queue.writeBuffer(
                uniformBuffer,
                offset * Float32Array.BYTES_PER_ELEMENT,
                uniformBufferData.buffer,
                uniformBufferData.byteOffset + offset * Float32Array.BYTES_PER_ELEMENT,
                uploadCount * Float32Array.BYTES_PER_ELEMENT
            );
        }

        function recordRenderPass(passEncoder: GPURenderBundleEncoder | GPURenderPassEncoder) {
            if (settings.dynamicOffsets) {
                passEncoder.setPipeline(dynamicPipeline);
            } else {
                passEncoder.setPipeline(pipeline);
            }
            passEncoder.setVertexBuffer(0, vertexBuffer);
            passEncoder.setBindGroup(0, timeBindGroup);
            const dynamicOffsets = [0];
            for(let i = 0; i < numTriangles; ++i) {
                if(settings.dynamicOffsets) {
                    dynamicOffsets[0] = i * alignedUniformBytes;
                    passEncoder.setBindGroup(1, dynamicBindGroup, dynamicOffsets);
                } else {
                    passEncoder.setBindGroup(1, bindGroups[i]);
                }
                passEncoder.draw(3, 1, 0, 0);
            }
        }

        let startTime: number = undefined;
        const uniformTime = new Float32Array([0]);
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [
                {
                    view: undefined,
                    loadValue: [0, 0, 0, 1],
                    storeOp: "store"
                }
            ]
        }

        const renderBundleEncoder = device.createRenderBundleEncoder({ colorFormats: [ presentationFormat ]});
        recordRenderPass(renderBundleEncoder);
        const renderBundle = renderBundleEncoder.finish();

        return function doDraw(timestamp: number) {
            if (startTime === undefined) {
                startTime = timestamp;
            }
            uniformTime[0] = (timestamp - startTime) / 1000;
            device.queue.writeBuffer(uniformBuffer, timeOffset, uniformTime.buffer);
            renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

            const commandEncoder = device.createCommandEncoder();
            const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

            if(settings.renderBundles) {
                passEncoder.executeBundles([renderBundle]);
            } else {
                recordRenderPass(passEncoder);
            }
            passEncoder.endPass();
            device.queue.submit([commandEncoder.finish()]);
        }
    }

    let doDraw = configure();

    const updateSettings = () => {
        doDraw = configure();
    };

    const body = document.querySelector("body");

    body.appendChild(document.createElement("hr"));
    body.appendChild(new Text("numTriangles"));
    const numTrianglesInput = document.createElement("input");
    numTrianglesInput.type = "number";
    numTrianglesInput.value = "20000";
    numTrianglesInput.addEventListener("change", e => {
        settings.numTriangles = (e.currentTarget as HTMLInputElement).valueAsNumber;
        updateSettings();
    });
    body.appendChild(numTrianglesInput);


    body.appendChild(new Text("dynamicOffsets"));
    const dynamicOffsetsCheckbox = document.createElement("input");
    dynamicOffsetsCheckbox.type = "checkbox";
    dynamicOffsetsCheckbox.addEventListener("input", e => {
        settings.dynamicOffsets = (e.currentTarget as HTMLInputElement).checked;
        updateSettings();
    })
    body.appendChild(dynamicOffsetsCheckbox);

    body.appendChild(new Text("renderBundles"));
    const renderBundlesCheckbox = document.createElement("input");
    renderBundlesCheckbox.type = "checkbox";
    renderBundlesCheckbox.addEventListener("input", e => {
        settings.renderBundles = (e.currentTarget as HTMLInputElement).checked;
        updateSettings();
    })
    body.appendChild(renderBundlesCheckbox);

    const avgJavascript = document.createElement("div");
    body.appendChild(avgJavascript);
    const avgFrameDisplay = document.createElement("div");
    body.appendChild(avgFrameDisplay);
    
    let previousFrameTimestamp = undefined;
    let jsTimeAvg = undefined;
    let frameTimeAvg = undefined;
    let updateDisplay = true;

    function frame(timestamp : number) {
        let frameTime = 0;
        if (previousFrameTimestamp !== undefined) {
          frameTime = timestamp - previousFrameTimestamp;
        }
        previousFrameTimestamp = timestamp;
    
        const start = performance.now();
        doDraw(timestamp);
        const jsTime = performance.now() - start;
        if (frameTimeAvg === undefined) {
          frameTimeAvg = frameTime;
        }
        if (jsTimeAvg === undefined) {
          jsTimeAvg = jsTime;
        }
        const w = 0.2;
        frameTimeAvg = (1 - w) * frameTimeAvg + w * frameTime;
        jsTimeAvg = (1 - w) * jsTimeAvg + w * jsTime;

        if(updateDisplay) {
            avgFrameDisplay.innerText = `avg frame: ${frameTimeAvg} ms`;
            avgJavascript.innerText = `avg js: ${jsTimeAvg} ms`;
            updateDisplay = false;
            setTimeout(() => { updateDisplay = true}, 100);
        }
        
        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}