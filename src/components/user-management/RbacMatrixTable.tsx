import React from 'react';
import { Shield, Check, X } from 'lucide-react';
import { PermissionMatrixItem } from './userManagementTypes';

interface RbacMatrixTableProps {
  matrix: PermissionMatrixItem[];
}

function renderCellContent(val: boolean | string) {
  if (val === true) {
    return <Check className="w-4 h-4 text-emerald-600 mx-auto" />;
  }
  if (val === false) {
    return <X className="w-4 h-4 text-slate-300 mx-auto" />;
  }
  return <span className="text-[10px] text-slate-500">{val}</span>;
}

export const RbacMatrixTable: React.FC<RbacMatrixTableProps> = ({ matrix }) => {
  return (
    <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-xs">
      <h3 className="text-sm font-bold text-slate-900 flex items-center">
        <Shield className="w-4 h-4 mr-2 text-blue-600" />
        全业务功能模块权限对照矩阵 (RBAC Permission Matrix)
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-50 text-[11px] text-slate-600 border-b border-slate-200 font-semibold">
            <tr>
              <th className="px-4 py-2.5">功能业务模块</th>
              <th className="px-4 py-2.5 text-center text-rose-600">系统管理员</th>
              <th className="px-4 py-2.5 text-center text-orange-600">维修技师</th>
              <th className="px-4 py-2.5 text-center text-blue-600">巡检/质检员</th>
              <th className="px-4 py-2.5 text-center text-slate-600">普通用户/操作员</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {matrix.map((item, idx) => (
              <tr key={idx} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-2.5 font-semibold text-slate-800">{item.module}</td>
                <td className="px-4 py-2.5 text-center">{renderCellContent(item.admin)}</td>
                <td className="px-4 py-2.5 text-center">{renderCellContent(item.technician)}</td>
                <td className="px-4 py-2.5 text-center">{renderCellContent(item.inspector)}</td>
                <td className="px-4 py-2.5 text-center">{renderCellContent(item.operator)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
