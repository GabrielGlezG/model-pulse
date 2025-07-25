import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface JsonData {
  Marca: string;
  Categoría: string;
  "Modelo Principal": string;
  Modelo: string;
  Submodelo?: string;
  Precio: number;
  "Fecha Scraping": string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: jsonData, batchId } = await req.json();
    console.log('Processing JSON upload with batchId:', batchId);
    console.log('Data length:', jsonData.length);

    // Create scraping job
    const { data: job, error: jobError } = await supabaseClient
      .from('scraping_jobs')
      .insert({
        id: batchId,
        status: 'processing',
        total_products: jsonData.length,
        completed_products: 0
      })
      .select()
      .single();

    if (jobError) {
      console.error('Error creating job:', jobError);
      throw jobError;
    }

    let processedCount = 0;
    const results = [];

    for (const item of jsonData as JsonData[]) {
      try {
        // Create or get product
        const productData = {
          brand: item.Marca,
          category: item.Categoría,
          model: item["Modelo Principal"],
          name: item.Modelo,
        };

        let { data: product, error: productError } = await supabaseClient
          .from('products')
          .select('id')
          .eq('brand', item.Marca)
          .eq('model', item["Modelo Principal"])
          .eq('name', item.Modelo)
          .maybeSingle();

        if (!product) {
          const { data: newProduct, error: insertError } = await supabaseClient
            .from('products')
            .insert(productData)
            .select('id')
            .single();

          if (insertError) {
            console.error('Error creating product:', insertError);
            results.push({ item, error: insertError.message });
            continue;
          }
          product = newProduct;
        }

        // Insert price data
        const { error: priceError } = await supabaseClient
          .from('price_data')
          .insert({
            product_id: product.id,
            store: item.Marca + ' Store',
            price: item.Precio,
            date: new Date(item["Fecha Scraping"]).toISOString(),
          });

        if (priceError) {
          console.error('Error inserting price:', priceError);
          results.push({ item, error: priceError.message });
        } else {
          results.push({ item, success: true });
        }

        processedCount++;

        // Update job progress
        await supabaseClient
          .from('scraping_jobs')
          .update({ completed_products: processedCount })
          .eq('id', batchId);

      } catch (error) {
        console.error('Error processing item:', error);
        results.push({ item, error: error.message });
      }
    }

    // Complete job
    await supabaseClient
      .from('scraping_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        results: results
      })
      .eq('id', batchId);

    console.log('Job completed. Processed:', processedCount, 'Total:', jsonData.length);

    return new Response(
      JSON.stringify({
        success: true,
        jobId: batchId,
        processed: processedCount,
        total: jsonData.length,
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});