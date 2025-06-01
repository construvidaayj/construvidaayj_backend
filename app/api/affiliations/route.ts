import { NextRequest, NextResponse } from 'next/server';
import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../lib/db'; // ¡Asegúrate de que este 'pool' esté configurado para MySQL!

export async function POST(request: NextRequest) {
  try {
    const { month, year, userId, officeId } = await request.json();

    console.log(`🔍 PARAMETROS - MES: ${month}, AÑO: ${year}, USER: ${userId}, OFICINA: ${officeId}`);

    if (!userId || !month || !year || !officeId) {
      return NextResponse.json(
        { error: 'Faltan parámetros: userId, month, year u officeId' },
        { status: 400 }
      );
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    if (isNaN(monthNum) || isNaN(yearNum) || monthNum < 1 || monthNum > 12) {
      // Agregamos validación de rango para mes como en los otros endpoints
      return NextResponse.json(
        { error: 'Mes o año inválido. Asegúrese de que el mes esté entre 1 y 12.' },
        { status: 400 }
      );
    }

    // --- 1. (Opcional) Validar si el usuario tiene acceso a esa oficina ---
    // MySQL usa '?' como placeholder, y verifica .length
    const accessCheckQuery = `
      SELECT 1 FROM user_offices WHERE user_id = ? AND office_id = ?;
    `;
    const [accessCheckRows]: any[] = await pool.query(
      accessCheckQuery,
      [userId, officeId]
    );

    if (accessCheckRows.length === 0) {
      return NextResponse.json(
        { error: 'El usuario no tiene acceso a esta oficina' },
        { status: 403 }
      );
    }

    // --- 2. Consulta los clientes afiliados en ese mes y año EN ESA OFICINA ---
    // Adaptaciones clave para MySQL:
    // - `DATE_FORMAT` en lugar de `TO_CHAR` para fechas.
    // - `GROUP_CONCAT` en lugar de `array_agg` para los teléfonos.
    // - Nombres de columnas de la BD (e.g., `paid_status` en lugar de `paid`, `company_id` en lugar de `companies_id`).
    // - Placeholders `?` en lugar de `$N`.
    const query = `
      SELECT
        c.id AS client_id,
        c.full_name,
        c.identification,
        comp.name AS company_name,
        ma.id AS affiliation_id,
        ma.value,
        ma.risk,
        ma.observation,
        ps.status_name AS paid, -- Obtiene el nombre del estado desde payment_statuses
        DATE_FORMAT(ma.date_paid_received, '%Y-%m-%d') AS datePaidReceived,
        DATE_FORMAT(ma.gov_record_completed_at, '%Y-%m-%d') AS govRegistryCompletedAt,
        eps.name AS eps,
        arl.name AS arl,
        ccf.name AS ccf,
        pf.name AS pensionFund,
        GROUP_CONCAT(DISTINCT cp.phone_number SEPARATOR ',') AS phones_concat
      FROM monthly_affiliations ma
      INNER JOIN clients c ON c.id = ma.client_id
      INNER JOIN companies comp ON c.company_id = comp.id -- Usando 'company_id' como en tu esquema MySQL
      INNER JOIN payment_statuses ps ON ma.paid_status = ps.status_name -- Unir por status_name (VARCHAR)
      LEFT JOIN eps_list eps ON ma.eps_id = eps.id
      LEFT JOIN arl_list arl ON ma.arl_id = arl.id
      LEFT JOIN ccf_list ccf ON ma.ccf_id = ccf.id
      LEFT JOIN pension_fund_list pf ON ma.pension_fund_id = pf.id
      LEFT JOIN client_phones cp ON c.id = cp.client_id
      WHERE ma.office_id = ? -- El primer parámetro 'officeId'
        AND ma.month = ? -- El segundo parámetro 'monthNum'
        AND ma.year = ? -- El tercer parámetro 'yearNum'
        AND ma.is_active = TRUE
        AND ma.deleted_at IS NULL
      GROUP BY
        c.id, c.full_name, c.identification, comp.name,
        ma.id, ma.value, ma.risk, ma.observation, ma.paid_status, -- Usar ma.paid_status aquí para el GROUP BY
        ma.date_paid_received, ma.gov_record_completed_at,
        eps.name, arl.name, ccf.name, pf.name, ps.status_name -- Asegurarse de que ps.status_name esté en GROUP BY
      ORDER BY c.full_name;
    `;

    // Ejecutar la consulta con los parámetros en el orden correcto
    const [rows]: any[] = await pool.query(query, [officeId, monthNum, yearNum]);

    if (rows.length === 0) {
      return NextResponse.json(
        { message: 'No hay afiliaciones registradas para ese mes, año y oficina' },
        { status: 404 }
      );
    }

    // --- 3. Formatear los datos de la respuesta para el frontend ---
    const data = rows.map((row: any) => ({
      clientId: row.client_id,
      affiliationId: row.affiliation_id,
      fullName: row.full_name,
      identification: row.identification,
      companyName: row.company_name,
      value: row.value,
      risk: row.risk,
      observation: row.observation,
      paid: row.paid, // Ahora viene directamente del alias ps.status_name AS paid
      datePaidReceived: row.datePaidReceived, // Ya está formateado por DATE_FORMAT
      govRegistryCompletedAt: row.govRegistryCompletedAt, // Ya está formateado por DATE_FORMAT
      eps: row.eps,
      arl: row.arl,
      ccf: row.ccf,
      pensionFund: row.pensionFund,
      // Convertir la cadena GROUP_CONCAT a un array de teléfonos
      phones: row.phones_concat ? row.phones_concat.split(',') : [],
    }));

    return NextResponse.json(data, { status: 200 });

  } catch (error) {
    console.error('🔥 Error en el servidor:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { affiliationId, userId } = body; // Todavía recibimos userId para el deleted_by

    console.log(`USUARIO QUE ELIMINA EL REGISTRO: ${userId}`);
    console.log(`AFILIACION QUE SE ELIMINA: ${affiliationId}`);

    if (!affiliationId || !userId) {
      return NextResponse.json( // Usar NextResponse.json para consistencia
        { message: 'Faltan datos requeridos (affiliationId y userId)' },
        { status: 400 }
      );
    }

    // --- 1. Verificación de que la afiliación exista y esté activa ---
    // MySQL usa '?' como placeholder, y verifica .length
    const affiliationCheckQuery = `
      SELECT 1 FROM monthly_affiliations WHERE id = ? AND is_active = TRUE;
    `;
    const [affiliationCheckRows]: any[] = await pool.query(
      affiliationCheckQuery,
      [affiliationId]
    );

    if (affiliationCheckRows.length === 0) { // MySQL: verificar .length
      return NextResponse.json( // Usar NextResponse.json para consistencia
        { message: 'Afiliación no encontrada o ya eliminada' },
        { status: 404 }
      );
    }

    // --- 2. Eliminación lógica de la afiliación ---
    // Tu esquema MySQL tiene 'deleted_by_user_id', no 'deleted_by'. Ajustamos esto.
    const updateQuery = `
      UPDATE monthly_affiliations
      SET 
        is_active = FALSE,
        deleted_at = CURRENT_TIMESTAMP,
        deleted_by_user_id = ? -- Nombre de columna correcto en tu esquema MySQL
      WHERE 
        id = ?;
    `;

    const [result]: any[] = await pool.query( // mysql2/promise devuelve [rows, fields]
      updateQuery,
      [userId, affiliationId]
    );

    // Opcional: Puedes verificar si alguna fila fue afectada para una respuesta más precisa
    if (result.affectedRows === 0) {
        return NextResponse.json({ message: 'No se pudo eliminar la afiliación o no hubo cambios' }, { status: 500 });
    }

    return NextResponse.json( // Usar NextResponse.json para consistencia
      { message: 'Afiliación eliminada correctamente' },
      { status: 200 }
    );

  } catch (error) {
    console.error('🔥 Error al eliminar afiliación:', error);
    return NextResponse.json({ message: 'Error del servidor al eliminar la afiliación' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  // Declaramos y tipamos la conexión para que sea segura en el bloque finally
  let connection: PoolConnection | undefined;
  try {
    // Tipamos explícitamente el cuerpo de la solicitud JSON para mayor claridad y seguridad
    const {
      affiliationId,
      clientId,
      fullName,
      identification,
      companyId,
      phones, // Esperamos un array de strings (ej. ['+573001234567'])
      value,
      eps,
      arl,
      risk,
      ccf,
      pensionFund,
      paid, // Esperamos el 'status_name' de payment_statuses (ej. 'Pagado', 'Pendiente')
      observation,
      govRegistryCompletedAt, // Esperamos un string de fecha/hora compatible con MySQL (ej. 'YYYY-MM-DD HH:MM:SS')
      datePaidReceived // Esperamos un string de fecha/hora compatible con MySQL
    }: {
      affiliationId: number;
      clientId: number;
      fullName: string;
      identification: string;
      companyId: number;
      phones: string[];
      value: number;
      eps: string;
      arl: string;
      risk: string;
      ccf: string;
      pensionFund: string;
      paid: string;
      observation: string;
      govRegistryCompletedAt?: string | null; // Puede ser opcional y nulo
      datePaidReceived?: string | null; // Puede ser opcional y nulo
    } = await request.json();

    console.log('DATOS RECIBIDOS DESDE EL FRONT:', {
      affiliationId, clientId, fullName, identification, companyId, phones,
      value, eps, arl, risk, ccf, pensionFund, paid, observation,
      govRegistryCompletedAt, datePaidReceived
    });

    if (!affiliationId || !clientId) {
      return NextResponse.json(
        { error: 'Faltan el ID de la afiliación o el ID del cliente para actualizar.' },
        { status: 400 }
      );
    }

    connection = await pool.getConnection(); // Obtenemos una conexión del pool

    // --- Función auxiliar para obtener IDs de catálogo ---
    // Tipamos los parámetros y el valor de retorno de la función
    const getCatalogId = async (table: string, name: string | null): Promise<number | null> => {
      if (!name) return null;
      // Usamos 'connection!' para asegurar a TypeScript que 'connection' no es undefined aquí
      const [rows]: [any[], any[]] = await connection!.execute(
        `SELECT id FROM ${table} WHERE name = ?`, // '?' para MySQL
        [name]
      );
      // Hacemos un 'as number | null' para tipar el resultado
      const catalogId = rows[0]?.id as number | null;
      console.log(`ID obtenido de ${table} para "${name}":`, catalogId);
      return catalogId;
    };

    // Obtenemos los IDs de los catálogos, tipando las variables
    const epsId: number | null = await getCatalogId('eps_list', eps);
    const arlId: number | null = await getCatalogId('arl_list', arl);
    const ccfId: number | null = await getCatalogId('ccf_list', ccf);
    const pensionFundId: number | null = await getCatalogId('pension_fund_list', pensionFund);

    console.log('ID\'s de catálogos obtenidos:', { epsId, arlId, ccfId, pensionFundId });

    // --- Inicio de la Transacción ---
    // Usamos transacciones para asegurar que todas las actualizaciones (en múltiples tablas)
    // sean atómicas: o todas se completan con éxito, o ninguna lo hace.
    await connection.beginTransaction();
    console.log('Transacción iniciada.');

    try {
      // 1. Actualizar la tabla monthly_affiliations
      const affiliationQuery = `
        UPDATE monthly_affiliations
        SET
          value = ?,
          eps_id = ?,
          arl_id = ?,
          risk = ?,
          ccf_id = ?,
          pension_fund_id = ?,
          paid_status = ?, -- Asegúrate de que el nombre de la columna coincide con tu DB (era 'paid')
          observation = ?,
          gov_record_completed_at = ?, -- Asegúrate de que el nombre de la columna coincide con tu DB
          date_paid_received = ?,
          updated_at = NOW()
        WHERE id = ?
      `;

      // Tipamos explícitamente el array de valores para la consulta
      const affiliationValues: (string | number | null)[] = [
        value,
        epsId,
        arlId,
        risk,
        ccfId,
        pensionFundId,
        paid,
        observation,
        govRegistryCompletedAt || null, // Pasa null si está vacío
        datePaidReceived || null,     // Pasa null si está vacío
        affiliationId,
      ];

      console.log('Query para monthly_affiliations:', affiliationQuery);
      console.log('Valores para monthly_affiliations:', affiliationValues);

      // Ejecutamos la consulta y tipamos el resultado como ResultSetHeader
      const [affiliationResult]: [ResultSetHeader, any] = await connection.execute(
        affiliationQuery,
        affiliationValues
      );
      console.log('Resultado de la actualización de monthly_affiliations:', affiliationResult);

      // Verificamos si se afectó alguna fila (affectedRows para UPDATE en mysql2)
      if (affiliationResult.affectedRows === 0) {
        throw new Error('No se encontró la afiliación con el ID proporcionado para actualizar.');
      }

      // 2. Actualizar la tabla clients
      const clientQuery = `
        UPDATE clients
        SET
          full_name = ?,
          identification = ?,
          company_id = ?, -- Asegúrate de que el nombre de la columna coincide (era 'companies_id')
          updated_at = NOW()
        WHERE id = ?
      `;
      // Tipamos el array de valores
      const clientValues: (string | number)[] = [fullName, identification, companyId, clientId];
      console.log('Query para clients:', clientQuery);
      console.log('Valores para clients:', clientValues);

      const [clientResult]: [ResultSetHeader, any] = await connection.execute(
        clientQuery,
        clientValues
      );
      console.log('Resultado de la actualización de clients:', clientResult);

      if (clientResult.affectedRows === 0) {
        throw new Error('No se encontró el cliente con el ID proporcionado para actualizar.');
      }

      // 3. Actualizar la tabla client_phones
      // Primero, eliminamos los teléfonos existentes para este cliente.
      console.log('Eliminando teléfonos antiguos para el cliente ID:', clientId);
      await connection.execute(`DELETE FROM client_phones WHERE client_id = ?`, [clientId]);
      console.log('Teléfonos antiguos eliminados.');

      // Luego, insertamos los nuevos números de teléfono.
      if (phones && phones.length > 0) {
        const insertPhoneQuery = `
          INSERT INTO client_phones (client_id, phone_number)
          VALUES (?, ?)
        `;
        console.log('Query para insertar teléfonos:', insertPhoneQuery);
        for (const phone of phones) {
          console.log('Insertando teléfono:', clientId, phone);
          await connection.execute(insertPhoneQuery, [clientId, phone]);
        }
        console.log('Nuevos teléfonos insertados.');
      }

      // --- Commit de la Transacción ---
      // Si todo fue bien, confirmamos los cambios en la base de datos.
      await connection.commit();
      console.log('Transacción completada y cambios guardados.');

      return NextResponse.json(
        { message: 'Datos del cliente y afiliación actualizados exitosamente.' },
        { status: 200 }
      );

    } catch (transactionError: any) { // Capturamos el error de la transacción
      // --- Rollback en caso de error ---
      // Si algo falla, revertimos todos los cambios de esta transacción.
      await connection.rollback();
      console.error('🔥 Transacción revertida debido a un error:', transactionError);
      throw transactionError; // Relanzamos el error para que sea capturado por el catch externo
    }

  } catch (error: any) { // Capturamos cualquier error general
    console.error('🔥 Error general al actualizar los datos:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor al actualizar los datos.' },
      { status: 500 }
    );
  } finally {
    // --- Liberar la Conexión ---
    // ¡CRÍTICO! Siempre libera la conexión de vuelta al pool para evitar fugas de conexiones.
    if (connection) {
      connection.release();
      console.log('Conexión liberada.');
    }
  }
}