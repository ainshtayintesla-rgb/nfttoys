import React from 'react';

import styles from './DetailsTable.module.css';

export interface DetailsTableRow {
    id?: string | number;
    label: React.ReactNode;
    value: React.ReactNode;
    hidden?: boolean;
    mono?: boolean;
    rowClassName?: string;
    keyClassName?: string;
    valueClassName?: string;
}

interface DetailsTableProps {
    rows: DetailsTableRow[];
    className?: string;
    rowClassName?: string;
    keyClassName?: string;
    valueClassName?: string;
    monoValueClassName?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export const DetailsTable = ({
    rows,
    className,
    rowClassName,
    keyClassName,
    valueClassName,
    monoValueClassName,
}: DetailsTableProps) => {
    const visibleRows = rows.filter((row) => !row.hidden);

    return (
        <table className={cx(styles.table, className)}>
            <tbody>
                {visibleRows.map((row, index) => (
                    <tr key={row.id ?? index} className={cx(styles.row, rowClassName, row.rowClassName)}>
                        <th className={cx(styles.key, keyClassName, row.keyClassName)} scope="row">
                            {row.label}
                        </th>
                        <td
                            className={cx(
                                styles.value,
                                valueClassName,
                                row.valueClassName,
                                row.mono && (monoValueClassName || styles.valueMono),
                            )}
                        >
                            {row.value}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};
