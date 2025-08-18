import { describe, it, expect } from '@jest/globals';

describe('Metrics Logic', () => {
  describe('Metric Data Structure', () => {
    const createMetric = (name, value, unit = 'Count', dimensions = []) => {
      return {
        MetricName: name,
        Value: value,
        Unit: unit,
        Dimensions: dimensions.map(dim => ({
          Name: dim.name,
          Value: dim.value
        })),
        Timestamp: new Date()
      };
    };

    it('should create basic metric', () => {
      const metric = createMetric('TestMetric', 1);
      
      expect(metric).toMatchObject({
        MetricName: 'TestMetric',
        Value: 1,
        Unit: 'Count',
        Dimensions: []
      });
      expect(metric.Timestamp).toBeInstanceOf(Date);
    });

    it('should create metric with dimensions', () => {
      const dimensions = [
        { name: 'Environment', value: 'test' },
        { name: 'Component', value: 'webhook-handler' }
      ];
      
      const metric = createMetric('ProcessedEvents', 5, 'Count', dimensions);
      
      expect(metric.Dimensions).toEqual([
        { Name: 'Environment', Value: 'test' },
        { Name: 'Component', Value: 'webhook-handler' }
      ]);
    });

    it('should create metric with custom unit', () => {
      const metric = createMetric('ProcessingTime', 1500, 'Milliseconds');
      
      expect(metric.Unit).toBe('Milliseconds');
      expect(metric.Value).toBe(1500);
    });
  });

  describe('Metric Aggregation', () => {
    const aggregateMetrics = (metrics) => {
      const aggregated = {};
      
      metrics.forEach(metric => {
        const key = `${metric.MetricName}-${metric.Unit}`;
        
        if (!aggregated[key]) {
          aggregated[key] = {
            MetricName: metric.MetricName,
            Unit: metric.Unit,
            Values: [],
            Count: 0,
            Sum: 0,
            Min: Infinity,
            Max: -Infinity
          };
        }
        
        const agg = aggregated[key];
        agg.Values.push(metric.Value);
        agg.Count++;
        agg.Sum += metric.Value;
        agg.Min = Math.min(agg.Min, metric.Value);
        agg.Max = Math.max(agg.Max, metric.Value);
      });
      
      // Calculate averages
      Object.values(aggregated).forEach(agg => {
        agg.Average = agg.Sum / agg.Count;
      });
      
      return aggregated;
    };

    it('should aggregate single metric', () => {
      const metrics = [
        { MetricName: 'TestMetric', Value: 5, Unit: 'Count' }
      ];
      
      const result = aggregateMetrics(metrics);
      
      expect(result['TestMetric-Count']).toMatchObject({
        MetricName: 'TestMetric',
        Unit: 'Count',
        Count: 1,
        Sum: 5,
        Min: 5,
        Max: 5,
        Average: 5
      });
    });

    it('should aggregate multiple metrics', () => {
      const metrics = [
        { MetricName: 'ResponseTime', Value: 100, Unit: 'Milliseconds' },
        { MetricName: 'ResponseTime', Value: 200, Unit: 'Milliseconds' },
        { MetricName: 'ResponseTime', Value: 150, Unit: 'Milliseconds' }
      ];
      
      const result = aggregateMetrics(metrics);
      
      expect(result['ResponseTime-Milliseconds']).toMatchObject({
        Count: 3,
        Sum: 450,
        Min: 100,
        Max: 200,
        Average: 150
      });
    });
  });

  describe('Timer Implementation', () => {
    const createTimer = (metricName) => {
      const startTime = Date.now();
      
      return {
        stop: () => {
          const duration = Date.now() - startTime;
          return {
            MetricName: metricName,
            Value: duration,
            Unit: 'Milliseconds',
            Timestamp: new Date()
          };
        },
        getDuration: () => Date.now() - startTime
      };
    };

    it('should create timer and measure duration', async () => {
      const timer = createTimer('TestOperation');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const metric = timer.stop();
      
      expect(metric.MetricName).toBe('TestOperation');
      expect(metric.Unit).toBe('Milliseconds');
      expect(metric.Value).toBeGreaterThan(0);
    });

    it('should get current duration without stopping', async () => {
      const timer = createTimer('TestOperation');
      
      await new Promise(resolve => setTimeout(resolve, 5));
      
      const duration = timer.getDuration();
      expect(duration).toBeGreaterThan(0);
      
      // Timer should still be running
      await new Promise(resolve => setTimeout(resolve, 5));
      const newDuration = timer.getDuration();
      expect(newDuration).toBeGreaterThan(duration);
    });
  });

  describe('Metric Validation', () => {
    const validateMetric = (metric) => {
      const errors = [];
      
      if (!metric.MetricName || typeof metric.MetricName !== 'string') {
        errors.push('MetricName is required and must be a string');
      }
      
      if (metric.Value === undefined || typeof metric.Value !== 'number') {
        errors.push('Value is required and must be a number');
      }
      
      if (metric.Unit && typeof metric.Unit !== 'string') {
        errors.push('Unit must be a string');
      }
      
      if (metric.Dimensions && !Array.isArray(metric.Dimensions)) {
        errors.push('Dimensions must be an array');
      }
      
      if (metric.Dimensions) {
        metric.Dimensions.forEach((dim, index) => {
          if (!dim.Name || typeof dim.Name !== 'string') {
            errors.push(`Dimension ${index} Name is required and must be a string`);
          }
          if (!dim.Value || typeof dim.Value !== 'string') {
            errors.push(`Dimension ${index} Value is required and must be a string`);
          }
        });
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    };

    it('should validate correct metric', () => {
      const metric = {
        MetricName: 'TestMetric',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Environment', Value: 'test' }
        ]
      };
      
      const result = validateMetric(metric);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing metric name', () => {
      const metric = { Value: 1 };
      
      const result = validateMetric(metric);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('MetricName is required and must be a string');
    });

    it('should detect missing value', () => {
      const metric = { MetricName: 'TestMetric' };
      
      const result = validateMetric(metric);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Value is required and must be a number');
    });

    it('should detect invalid dimensions', () => {
      const metric = {
        MetricName: 'TestMetric',
        Value: 1,
        Dimensions: [
          { Name: 'Environment' } // Missing Value
        ]
      };
      
      const result = validateMetric(metric);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Dimension 0 Value is required and must be a string');
    });
  });

  describe('Metric Batching', () => {
    const batchMetrics = (metrics, batchSize = 20) => {
      const batches = [];
      
      for (let i = 0; i < metrics.length; i += batchSize) {
        batches.push(metrics.slice(i, i + batchSize));
      }
      
      return batches;
    };

    it('should create single batch for small metric set', () => {
      const metrics = [
        { MetricName: 'Metric1', Value: 1 },
        { MetricName: 'Metric2', Value: 2 }
      ];
      
      const batches = batchMetrics(metrics);
      
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
    });

    it('should create multiple batches for large metric set', () => {
      const metrics = Array.from({ length: 25 }, (_, i) => ({
        MetricName: `Metric${i}`,
        Value: i
      }));
      
      const batches = batchMetrics(metrics, 10);
      
      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(10);
      expect(batches[1]).toHaveLength(10);
      expect(batches[2]).toHaveLength(5);
    });
  });

  describe('Error Metrics', () => {
    const createErrorMetric = (errorType, context = {}) => {
      const dimensions = [
        { Name: 'ErrorType', Value: errorType }
      ];
      
      if (context.component) {
        dimensions.push({ Name: 'Component', Value: context.component });
      }
      
      if (context.operation) {
        dimensions.push({ Name: 'Operation', Value: context.operation });
      }
      
      return {
        MetricName: 'Errors',
        Value: 1,
        Unit: 'Count',
        Dimensions: dimensions,
        Timestamp: new Date()
      };
    };

    it('should create basic error metric', () => {
      const metric = createErrorMetric('NetworkError');
      
      expect(metric.MetricName).toBe('Errors');
      expect(metric.Value).toBe(1);
      expect(metric.Dimensions).toContainEqual({
        Name: 'ErrorType',
        Value: 'NetworkError'
      });
    });

    it('should create error metric with context', () => {
      const metric = createErrorMetric('ValidationError', {
        component: 'webhook-handler',
        operation: 'validatePayload'
      });
      
      expect(metric.Dimensions).toContainEqual({
        Name: 'Component',
        Value: 'webhook-handler'
      });
      expect(metric.Dimensions).toContainEqual({
        Name: 'Operation',
        Value: 'validatePayload'
      });
    });
  });
});