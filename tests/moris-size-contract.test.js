import {describe,it,expect} from 'vitest';
import * as client from '../src/moris/size-contract.js';
import * as server from '../functions/_lib/moris/v5/retrieval/sizeGate.js';

describe('M28 Size Contract — quy ước (L>=W), dung sai 2 tầng, d_max hoán vị',()=>{
  it('normalizeSizePair tự hoán vị về L>=W và từ chối dữ liệu không hợp lệ',()=>{
    expect(client.normalizeSizePair(30,120)).toEqual({length_mm:120,width_mm:30});
    expect(client.normalizeSizePair('12,5','40')).toEqual({length_mm:40,width_mm:12.5});
    for(const [l,w] of [[0,10],[10,0],[-4,10],[5001,10],[NaN,5],[null,5],['','5'],['abc',5]]){
      expect(client.normalizeSizePair(l,w),`(${l},${w}) phải null`).toBeNull();
    }
  });

  it('shapeClass dùng ngưỡng 5% trên cạnh dài (vuông không special case)',()=>{
    expect(client.shapeClass(100,100)).toBe('square');
    expect(client.shapeClass(100,95)).toBe('square');
    expect(client.shapeClass(100,94.9)).toBe('rect');
    expect(client.shapeClass(0,10)).toBeNull();
  });

  it('toleranceForEdge = max(5% * cạnh, sàn 2mm)',()=>{
    expect(client.toleranceForEdge(100)).toBeCloseTo(5,6);
    expect(client.toleranceForEdge(30)).toBe(2);
    expect(client.toleranceForEdge(40)).toBe(2);
    expect(client.toleranceForEdge(1000)).toBeCloseTo(50,6);
    expect(client.toleranceForEdge(0)).toBeNull();
    expect(client.toleranceForEdge(100,{relative:0.1,floorMm:0})).toBeCloseTo(10,6);
  });

  it('evaluateSizeMatch: khớp identity, đúng biên sàn 2mm, quá dung sai là mismatch',()=>{
    const q={length_mm:20,width_mm:20};
    expect(client.evaluateSizeMatch(q,{length_mm:22,width_mm:20}).status).toBe('match');
    expect(client.evaluateSizeMatch(q,{length_mm:23,width_mm:20}).status).toBe('mismatch');

    const long={length_mm:104,width_mm:55};
    expect(client.evaluateSizeMatch(long,{length_mm:100,width_mm:55}).status).toBe('match');
    expect(client.evaluateSizeMatch(long,{length_mm:98,width_mm:55}).status).toBe('mismatch');
  });

  it('evaluateSizeMatch: candidate nhập ngược thứ tự vẫn khớp sau chuẩn hoá',()=>{
    const verdict=client.evaluateSizeMatch({length_mm:120,width_mm:30},{length_mm:30,width_mm:120});
    expect(verdict.status).toBe('match');
    expect(verdict.permutation).toBe('identity');
  });

  it('evaluateSizeMatch: trung tính (unknown) khi thiếu dims ứng viên',()=>{
    const verdict=client.evaluateSizeMatch({length_mm:40,width_mm:20},null);
    expect(verdict.status).toBe('unknown');
    expect(verdict.d_max).toBeNull();
  });

  it('d_max dùng hướng khớp tốt nhất sau chuẩn hoá (hoán vị đã được chuẩn hoá bao trùm)',()=>{
    const verdict=client.evaluateSizeMatch({length_mm:100,width_mm:60},{length_mm:59,width_mm:63});
    expect(verdict.status).toBe('mismatch');
    expect(verdict.permutation).toBe('identity');
    expect(verdict.d_max).toBeCloseTo(37/100,6);
    expect(client.sizeDistance({length_mm:100,width_mm:60},{length_mm:59,width_mm:63})).toBeCloseTo(0.37,6);
    expect(client.sizeDistance(null,{length_mm:1,width_mm:1})).toBeNull();
  });

  it('normalizeQuerySize chuẩn hoá payload và làm sạch source/confidence',()=>{
    expect(client.normalizeQuerySize({length_mm:20,width_mm:30,source:'user',confidence:0.6}))
      .toEqual({length_mm:30,width_mm:20,shape_class:'rect',source:'user',confidence:0.6});
    expect(client.normalizeQuerySize({lengthMm:50,widthMm:50})).toMatchObject({length_mm:50,width_mm:50,shape_class:'square'});
    expect(client.normalizeQuerySize({length_mm:20,width_mm:30,source:'USER!!',confidence:2}).source).toBe('unknown');
    expect(client.normalizeQuerySize({length_mm:20,width_mm:30,source:'user',confidence:2}).confidence).toBeNull();
    expect(client.normalizeQuerySize({length_mm:-1,width_mm:30})).toBeNull();
    expect(client.normalizeQuerySize(null)).toBeNull();
  });

  it('formatSizePair hiển thị 1 chữ số thập phân',()=>{
    expect(client.formatSizePair({length_mm:12.34,width_mm:5})).toBe('12.3 × 5 mm');
    expect(client.formatSizePair({length_mm:100,width_mm:60})).toBe('100 × 60 mm');
    expect(client.formatSizePair(null)).toBe('');
  });

  it('mirror parity: client src/moris/size-contract.js === server sizeGate.js (cùng kết quả)',()=>{
    const pairs=[[100,60],[30,30],[12.5,40],[104,55],[59,63],[1000,900],[2,2],[5000,1]];
    for(const [l,w] of pairs){
      basicParity('normalizeSizePair',[l,w]);
      basicParity('shapeClass',[l,w]);
      basicParity('toleranceForEdge',[l]);
      basicParity('formatSizePair',[[l,w]]);
    }
    const queries=[
      [{length_mm:100,width_mm:60},{length_mm:104,width_mm:55}],
      [{length_mm:30,width_mm:30},{length_mm:31.4,width_mm:31.4}],
      [{length_mm:100,width_mm:60},{length_mm:59,width_mm:63}],
      [{length_mm:120,width_mm:30},null]
    ];
    for(const [q,c] of queries){
      expect(client.evaluateSizeMatch(q,c)).toEqual(server.evaluateSizeMatch(q,c));
    }
    for(const raw of [{length_mm:20,width_mm:30,source:'user',confidence:0.6},{lengthMm:50,widthMm:50},null]){
      expect(client.normalizeQuerySize(raw)).toEqual(server.normalizeQuerySize(raw));
    }

    function basicParity(fn,args){
      expect(client[fn](...args),`${fn}(${JSON.stringify(args)})`).toEqual(server[fn](...args));
    }
  });
});
