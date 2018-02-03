import {Component, Listen, Prop} from '@stencil/core';
import {WebPhotoFilterType} from '../../types/web-photo-filter/web-photo-filter-type';

@Component({
  tag: 'web-photo-filter',
  styleUrl: 'web-photo-filter.scss',
  shadow: true
})
export class WebPhotoFilterComponent {

  @Prop() src: string;
  @Prop() alt: string;
  @Prop() filter: string;

  private createWebGLProgram(ctx, vertexShaderSource, fragmentShaderSource) {

    let compileShader = (shaderSource, shaderType) => {
      let shader = ctx.createShader(shaderType);
      ctx.shaderSource(shader, shaderSource);
      ctx.compileShader(shader);
      return shader;
    };

    let program = ctx.createProgram();
    ctx.attachShader(program, compileShader(vertexShaderSource, ctx.VERTEX_SHADER));
    ctx.attachShader(program, compileShader(fragmentShaderSource, ctx.FRAGMENT_SHADER));
    ctx.linkProgram(program);
    ctx.useProgram(program);

    return program;

  }

  private vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    uniform vec2 u_resolution;
    varying vec2 v_texCoord;
  
    void main() {
       vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0; // convert the rectangle from pixels to clipspace
       gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
       v_texCoord = a_texCoord; // pass the texCoord to the fragment shader
    }
  `;

  private fragmentShaderSource = `
    precision mediump float;
    uniform sampler2D u_image; // the texture
    uniform mat4 u_matrix;
    uniform vec4 u_multiplier;
    varying vec2 v_texCoord; // the texCoords passed from the vertex shader.
  
    void main() {
      vec4 color = texture2D(u_image, v_texCoord);
      mat4 colMat = mat4(
      color.r, 0, 0, 0,
      0, color.g, 0, 0,
      0, 0, color.b, 0,
      0, 0, 0, color.a
      );
      mat4 product = colMat * u_matrix;
      color.r = product[0].x + product[0].y + product[0].z + product[0].w + u_multiplier[0];
      color.g = product[1].x + product[1].y + product[1].z + product[1].w + u_multiplier[1];
      color.b = product[2].x + product[2].y + product[2].z + product[2].w + u_multiplier[2];
      color.a = product[3].x + product[3].y + product[3].z + product[3].w  + u_multiplier[3];
      gl_FragColor = color;
    }
  `;

  @Listen('lazyImgloaded')
  applyFilter(event: CustomEvent) {

    let matrix: number[] = WebPhotoFilterType.getFilter(this.filter);

    if (matrix === null) {
      return;
    }

    this.desaturateImage(event.detail, matrix);
  }

  private desaturateImage(image, feColorMatrix: number[]) {
    let canvas = document.createElement('canvas');
    image.parentNode.insertBefore(canvas, image);
    canvas.width  = image.width;
    canvas.height = image.height;
    image.parentNode.removeChild(image);

    let ctx;
    try {
      ctx = canvas.getContext("webgl")  || canvas.getContext("experimental-webgl");
    } catch(e) {}

    if (!ctx) {
      // You could fallback to 2D methods here
      alert("Sorry, it seems WebGL is not available.");
    }

    let program = this.createWebGLProgram(ctx, this.vertexShaderSource, this.fragmentShaderSource);

    // Expose canvas width and height to shader via u_resolution
    let resolutionLocation = ctx.getUniformLocation(program, "u_resolution");
    ctx.uniform2f(resolutionLocation, canvas.width, canvas.height);

    // Modify the feColorMatrix to fit better with available shader datatypes by putting the multiplier in a separate vector

    // This is a little unrefined but we're dealing with a very specific known data structure

    let cloneFeColorMatrix = feColorMatrix.slice();

    let feMultiplier = [];
    feMultiplier.push(cloneFeColorMatrix.splice(3,1)[0]);
    feMultiplier.push(cloneFeColorMatrix.splice(8,1)[0]);
    feMultiplier.push(cloneFeColorMatrix.splice(12,1)[0]);
    feMultiplier.push(cloneFeColorMatrix.splice(16,1)[0]);

    // Expose feColorMatrix to shader via u_matrix
    let matrixTransform = ctx.getUniformLocation(program, "u_matrix");
    ctx.uniformMatrix4fv(matrixTransform, false, new Float32Array(cloneFeColorMatrix));

    let multiplier = ctx.getUniformLocation(program, "u_multiplier");
    ctx.uniform4f(multiplier, feMultiplier[0], feMultiplier[1], feMultiplier[2], feMultiplier[3]);

    // Position rectangle vertices (2 triangles)
    let positionLocation = ctx.getAttribLocation(program, "a_position");
    let buffer = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([
      0, 0,
      image.width, 0,
      0, image.height,
      0, image.height,
      image.width, 0,
      image.width, image.height]), ctx.STATIC_DRAW);
    ctx.enableVertexAttribArray(positionLocation);
    ctx.vertexAttribPointer(positionLocation, 2, ctx.FLOAT, false, 0, 0);

    //Position texture
    let texCoordLocation = ctx.getAttribLocation(program, "a_texCoord");
    let texCoordBuffer = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, texCoordBuffer);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      0.0, 1.0,
      1.0, 0.0,
      1.0, 1.0]), ctx.STATIC_DRAW);
    ctx.enableVertexAttribArray(texCoordLocation);
    ctx.vertexAttribPointer(texCoordLocation, 2, ctx.FLOAT, false, 0, 0);

    // Create a texture.
    let texture = ctx.createTexture();
    ctx.bindTexture(ctx.TEXTURE_2D, texture);
    // Set the parameters so we can render any size image.
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.NEAREST);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.NEAREST);
    // Load the image into the texture.
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, image);

    // Draw the rectangle.
    ctx.drawArrays(ctx.TRIANGLES, 0, 6);
  }

  render() {
    return (
      <lazy-img src={this.src} alt={this.alt}></lazy-img>
    );
  }
}
