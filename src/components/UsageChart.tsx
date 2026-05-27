import React, { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { PieChart } from "echarts/charts";
import { SVGRenderer } from "echarts/renderers";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import type { QuotaMetric } from "../utils/dashboard";

echarts.use([PieChart, SVGRenderer]);

interface UsageChartProps {
  metric: QuotaMetric;
}

const TONE_COLORS: Record<QuotaMetric["tone"], string> = {
  critical: "#b86b45",
  warning: "#b79a58",
  healthy: "#5d897f",
};

function buildSeries(metric: QuotaMetric) {
  const remainingPercent = metric.available && metric.percent !== null ? metric.percent : null;

  return {
    type: "pie",
    center: ["50%", "50%"],
    radius: ["54%", "73%"],
    startAngle: 90,
    clockwise: true,
    silent: true,
    labelLine: { show: false },
    emphasis: { disabled: true },
    data:
      remainingPercent === null
        ? [
            {
              value: 100,
              itemStyle: {
                color: "#eceae6",
                borderColor: "#c8ccd1",
                borderWidth: 1.25,
                borderType: "dashed",
              },
            },
          ]
        : [
            {
              value: remainingPercent,
              itemStyle: {
                color: TONE_COLORS[metric.tone],
                shadowBlur: 18,
                shadowColor: "rgba(44, 52, 61, 0.18)",
              },
            },
            {
              value: Math.max(0, 100 - remainingPercent),
              itemStyle: {
                color: "#f1efeb",
              },
            },
          ],
    label: {
      show: true,
      position: "center",
      formatter:
        remainingPercent === null
          ? "{value|--}\n{name|未获取}"
          : `{value|${remainingPercent}%}\n{name|剩余}`,
      rich: {
        value: {
          fontSize: 18,
          fontWeight: 750,
          lineHeight: 24,
          color: "#0f172a",
          fontFamily: "\"SF Pro Display\", \"SF Pro Text\", ui-sans-serif, sans-serif",
        },
        name: {
          fontSize: 10,
          lineHeight: 12,
          color: "#64748b",
          fontFamily: "\"SF Pro Text\", ui-sans-serif, sans-serif",
        },
      },
    },
  };
}

const UsageChart: React.FC<UsageChartProps> = ({ metric }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const chart = echarts.init(containerRef.current, undefined, {
      renderer: "svg",
    });
    chartRef.current = chart;

    const option: EChartsCoreOption = {
      animationDuration: 450,
      animationDurationUpdate: 300,
      series: [buildSeries(metric)],
    };

    chart.setOption(option);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [metric]);

  return <div ref={containerRef} className="h-[96px] w-full" />;
};

export default UsageChart;
