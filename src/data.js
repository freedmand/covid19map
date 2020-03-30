import { Svue } from "svue";

// Deck.gl
import { ScatterplotLayer, PolygonLayer } from "@deck.gl/layers";
import TagmapLayer from "@/thirdparty/tagmap-layer";

const TRANSITION = {
  type: "spring"
};

const metrics = {
  'cases': {
    key: 'cases',
    description: 'Cumulative number of confirmed cases',
    handlePlural(count) {
      return count == 1 ? 'case' : 'cases';
    },
    getTotal(data, i = null) {
      if (i == null) i = data.caseIndex;
      return data.totalCases[i]
    },
    max(data) {
      return data.maxTotalCases
    },
    getCounty(_, county, i) {
      return county.cases[i];
    },
    getState(data, state, i) {
      return data.stateCases[state][i];
    }
  },
  'deaths': {
    key: 'deaths',
    description: 'Cumulative number of deaths',
    handlePlural(count) {
      return count == 1 ? 'death' : 'deaths';
    },
    getTotal(data, i = null) {
      if (i == null) i = data.caseIndex;
      return data.totalDeaths[i]
    },
    max(data) {
      return data.maxTotalDeaths
    },
    getCounty(_, county, i) {
      return county.deaths[i];
    },
    getState(data, state, i) {
      return data.stateDeaths[state][i];
    }
  },
  'deltaCases': {
    key: 'deltaCases',
    description: 'New cases per day',
    handlePlural(count) {
      return count == 1 ? 'new case' : 'new cases';
    },
    getTotal(data, i = null) {
      if (i == null) i = data.caseIndex;
      const yesterday = i - 1 < 0 ? 0 : data.totalCases[i - 1];
      return Math.max(data.totalCases[i] - yesterday, 0);
    },
    max(data) {
      return Math.max(...data.totalCases.map((cases, i) => {
        const yesterday = i - 1 < 0 ? 0 : data.totalCases[i - 1];
        return Math.max(cases - yesterday, 0);
      }))
    },
    getCounty(_, county, i) {
      const yesterday = i - 1 < 0 ? 0 : county.cases[i - 1];
      return Math.max(county.cases[i] - yesterday, 0);
    },
    getState(data, state, i) {
      const cases = data.stateCases[state][i];
      const yesterday = i - 1 < 0 ? 0 : data.stateCases[state][i - 1];
      return Math.max(cases - yesterday, 0);
    }
  },
};

export class Data extends Svue {
  constructor(data) {
    super({
      data() {
        return {
          ...data,
          deck: null,
          activeMetric: "cases",
          activeMetrics: ['cases', 'deaths', 'deltaCases'],
          caseIndex: data.numDays - 1,
          circleScale: 4000,
          retainCircleSize: true,
          showTextLabels: true,
          initialZoom: 0,
          showCounties: true,
          showTooltips: true,
          normalizeCircles: true,
          zoom: 0
        };
      },
      watch: {
        layers() {
          if (this.deck != null) {
            this.deck.setProps({ layers: this.layers });
          }
        },
      },
      computed: {
        metrics(activeMetrics) {
          return activeMetrics.map(x => metrics[x]);
        },
        metric(activeMetric) {
          return metrics[activeMetric];
        },
        zoomScale(initialZoom, zoom) {
          const initial = Math.pow(2, initialZoom);
          const current = Math.pow(2, zoom);
          return Math.min(initial / current, 1);
        },
        effectiveCircleScale(zoomScale, circleScale, retainCircleSize) {
          if (retainCircleSize) {
            return circleScale * zoomScale;
          } else {
            return circleScale;
          }
        },
        minX(bounds) {
          return bounds[0];
        },
        maxX(bounds) {
          return bounds[2];
        },
        minY(bounds) {
          return bounds[1];
        },
        maxY(bounds) {
          return bounds[3];
        },
        width(minX, maxX) {
          return maxX - minX;
        },
        height(minY, maxY) {
          return maxY - minY;
        },
        midX(minX, width) {
          return minX + width / 2;
        },
        midY(minY, height) {
          return minY + height / 2;
        },
        polygonCounties(counties) {
          return counties.filter(county => county.polygon.centroid != null);
        },
        countyRegions(polygonCounties, metric, caseIndex) {
          return polygonCounties
            .map(county =>
              county.polygon.centroid.multipoly.map(poly => ({
                poly,
                county,
                value:
                  metric.getCounty(this, county, caseIndex)
              }))
            )
            .flat(1);
        },
        countyCircles(polygonCounties, caseIndex, metric) {
          return polygonCounties.map(county => ({
            position: [county.polygon.centroid.x, county.polygon.centroid.y],
            radius: Math.sqrt(
              metric.getCounty(this, county, caseIndex)
            ),
            county
          }));
        },
        polygonStates(states) {
          return states.filter(state => state.polygon.centroid != null);
        },
        stateRegions(polygonStates) {
          return polygonStates
            .map(state =>
              state.polygon.centroid.multipoly.map(poly => ({ poly, state }))
            )
            .flat(1);
        },
        textData(states, polygonCounties, caseIndex, normalizeCircles, metric) {
          return polygonCounties
            .filter(
              county =>
                (metric.getCounty(this, county, caseIndex)) > 0
            )
            .map(county => ({
              label: `${county.name} ${metric.getCounty(this, county, caseIndex).toLocaleString()}`,
              position: [
                county.polygon.centroid.x,
                county.polygon.centroid.y
              ],
              weight: Math.sqrt(
                metric.getCounty(this, county, caseIndex)
              )
            }))
            .concat(
              states.map(state => ({
                label: state.shortcode,
                position: [
                  state.polygon.centroid.x,
                  state.polygon.centroid.y
                ],
                weight: normalizeCircles ? MAX_WEIGHT : maxTotalCases
              }))
            );
        },

        // Layers
        stateBgLayer(stateRegions) {
          return new PolygonLayer({
            id: "state-bg-regions",
            data: stateRegions,
            filled: true,
            stroked: false,
            getPolygon: d => d.poly,
            getFillColor: [255, 255, 255, 0],
            parameters: {
              depthTest: false
            },

            // Events
            pickable: true
          });
        },
        countyLayer(countyRegions, maxCountyCases, showCounties) {
          return new PolygonLayer({
            id: "county-regions",
            data: countyRegions,
            getPolygon: d => d.poly,
            getLineColor: d => {
              if (d.value == 0) return [255, 255, 255, 0];
              let shade = Math.max(
                Math.pow(d.value / maxCountyCases, 0.3) * 0.5,
                0.08
              );
              shade = 255 - shade * 255;
              shade = shade == 255 ? 255 : Math.min(shade * 0.8, 255);
              return [shade, shade, shade, shade];
            },
            getFillColor: d => {
              if (d.value == 0) return [255, 255, 255, 0];
              let shade = Math.max(
                Math.pow(d.value / maxCountyCases, 0.3) * 0.5,
                0.08
              );
              shade = 255 - shade * 255;
              return [255, shade, shade];
            },
            opacity: showCounties ? 1 : 0,
            lineWidthMinPixels: 0.5,
            lineWidthMaxPixels: 0.5,
            extruded: false,
            parameters: {
              depthTest: false
            },

            // Events
            pickable: true,

            // Animation
            transitions: {
              getLineColor: TRANSITION,
              getFillColor: TRANSITION,
              opacity: TRANSITION
            }
          });
        },
        stateLayer(stateRegions) {
          return new PolygonLayer({
            id: "state-regions",
            data: stateRegions,
            filled: false,
            getPolygon: d => d.poly,
            getLineColor: [128, 128, 128],
            lineWidthMinPixels: 0.5,
            lineWidthMaxPixels: 0.5,
            parameters: {
              depthTest: false
            }
          });
        },
        circleLayer(countyCircles, effectiveCircleScale) {
          return new ScatterplotLayer({
            id: "county-circles",
            data: countyCircles,
            radiusScale: effectiveCircleScale / 100,
            stroked: true,
            getFillColor: [255, 0, 0, 51],
            getLineColor: [255, 0, 0, 204],
            lineWidthMinPixels: 0.5,
            lineWidthMaxPixels: 0.5,
            getRadius: d => (d.radius < 0.01 ? 0 : d.radius),
            parameters: {
              depthTest: false
            },
            transitions: {
              getRadius: TRANSITION
            },

            // Events
            pickable: true
          });
        },
        textLayer(textData, showTextLabels) {
          return new TagmapLayer({
            id: "text-layer",
            data: textData,
            getLabel: x => x.label,
            getPosition: x => x.position,
            minFontSize: showTextLabels ? 10 : 0,
            maxFontSize: showTextLabels ? 14 : 0,
            colorScheme: [[0, 0, 0, 100]],
            weightThreshold: 50
          });
        },
        layers(
          stateBgLayer,
          countyLayer,
          stateLayer,
          circleLayer,
          textLayer
        ) {
          return [
            stateBgLayer,
            countyLayer,
            stateLayer,
            circleLayer,
            textLayer
          ];
        }
      }
    });
  }

  handlePlural(count) {
    return this.metric.handlePlural(count);
  }

  getTotal(i = null) {
    if (i == null) i = this.caseIndex;

    return this.metric.getTotal(this, i);
  }

  max() {
    return this.metric.max(this);
  }

  getCounty(county, i) {
    if (i == null) i = this.caseIndex;

    return this.metric.getCounty(this, county, i);
  }

  getState(state, i) {
    if (i == null) i = this.caseIndex;

    return this.metric.getState(this, state, i);
  }

  isActive(metric) {
    return this.activeMetric == metric.key;
  }
}
