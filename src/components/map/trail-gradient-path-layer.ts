import type { AccessorContext, Color } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";

type VertexColor = [number, number, number, number];
type NumericArrayLike = ArrayBufferView | number[];

function toColorTuple(color: Color): VertexColor {
  const alpha = color[3];
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    typeof alpha === "number" && Number.isFinite(alpha) ? alpha : 255,
  ];
}

export function flattenPathColors(
  pathLength: number,
  color: Color | Color[],
): Uint8Array {
  if (pathLength <= 0) {
    return new Uint8Array(0);
  }

  if (Array.isArray(color[0])) {
    const flattened = new Uint8Array(pathLength * 4);
    let offset = 0;
    const vertexColors = color as Color[];
    if (vertexColors.length !== pathLength) {
      throw new Error(
        "PathLayer getColor() returned vertex colors that do not match the path length",
      );
    }

    for (const vertexColor of vertexColors) {
      const tuple = toColorTuple(vertexColor);
      flattened[offset++] = tuple[0];
      flattened[offset++] = tuple[1];
      flattened[offset++] = tuple[2];
      flattened[offset++] = tuple[3];
    }

    return flattened;
  }

  const renderedSegmentCount = Math.max(pathLength - 1, 0);
  const flattened = new Uint8Array(renderedSegmentCount * 4);
  let offset = 0;
  const tuple = toColorTuple(color as Color);
  for (let index = 1; index < pathLength; index += 1) {
    flattened[offset++] = tuple[0];
    flattened[offset++] = tuple[1];
    flattened[offset++] = tuple[2];
    flattened[offset++] = tuple[3];
  }

  return flattened;
}

export class TrailGradientPathLayer<DataT = unknown> extends PathLayer<DataT> {
  override initializeState(): void {
    super.initializeState();
    this.getAttributeManager()?.addInstanced({
      instanceColors: {
        size: 4,
        type: "unorm8",
        accessor: "getColor",
        update: this.calculateColors.bind(this),
      },
    });
  }

  protected calculateColors(attribute: {
    value: NumericArrayLike | null;
    startIndices?: unknown;
  }): void {
    const { data, getPath, getColor } = this.props;
    const value = attribute.value;
    if (
      !(value instanceof Uint8Array) &&
      !(value instanceof Uint8ClampedArray)
    ) {
      return;
    }

    attribute.startIndices = this.state.pathTesselator.vertexStarts;
    let offset = 0;
    let objectIndex = 0;

    for (const object of data as Iterable<DataT>) {
      const objectInfo: AccessorContext<DataT> = {
        index: objectIndex,
        data: (data ?? []) as AccessorContext<DataT>["data"],
        target: [],
      };
      const path =
        typeof getPath === "function" ? getPath(object, objectInfo) : getPath;
      const color =
        typeof getColor === "function"
          ? getColor(object, objectInfo)
          : getColor;
      const colors = flattenPathColors(path.length, color);
      value.set(colors, offset);
      offset += colors.length;
      objectIndex += 1;
    }
  }
}

export default TrailGradientPathLayer;
